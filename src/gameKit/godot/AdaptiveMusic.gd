# Adaptive music player for Godot 4, from Bo's Beatbox.
#
# 1. Copy this folder (audio_manifest.json, states/, stems/, stingers/, transitions/) into your
#    project, e.g. res://music/.
# 2. Add this script to a Node and set music_dir in the Inspector, or make it an autoload called
#    Music and call Music.load_song("res://music/") once at the start.
# 3. Music.play("Explore"); Music.set_state("Combat"); Music.set_intensity(0.8); Music.stinger("Victory")
# 4. Sound effects: Music.play_sfx("sword_hit") plays a different variation each time;
#    var rain = Music.play_sfx("rain") loops until rain.stop() (or Music.stop_sfx("rain")).
# 5. Music.set_costume("8-bit") plays the same music another way from the same point ("": back);
#    Music.set_effect("underwater") muffles it ("muffled", "lowHealth", "dream", "none").
#
# Every state is a seamless loop exactly a whole number of bars long (and, when the song has stem
# groups, a set of stems of that length), so switching on a bar line keeps the beat. A state can
# also play its pieces in a shuffled order or leave silences between plays (shuffleBars and gap in
# the manifest). Switches are timed from the audio playback position, accurate to about a frame.
# The music plays through a bus of its own (sent to `bus`) with a low-pass and a reverb for effects.
extends Node

@export var music_dir := "res://music/"
@export var bus := "Master"
## The bus sound effects play on (make an "SFX" bus to give them their own volume)
@export var sfx_bus := "Master"

var data := {}
var streams := {}
var current_name := ""
var intensity := 1.0
## The state playing now: its players (one per stem, or one for the mix) and their stem groups
var _voices: Array = []
var _pending := ""
## The costume on now ("": as written)
var costume := ""
var _tempo := 1.0
var _play_id := 0
var _music_bus := ""
var _lowpass: AudioEffectLowPassFilter
var _reverb: AudioEffectReverb
var _effect_level := 1.0
var _effect_tween: Tween

const EFFECTS := {
	"none": [20000.0, 0.0, 1.0],
	"underwater": [650.0, 0.5, 1.0],
	"muffled": [1100.0, 0.12, 0.9],
	"lowHealth": [2200.0, 0.2, 0.85],
	"dream": [5000.0, 0.7, 0.9],
}

## The music's own bus (sent to `bus`), with a low-pass and a reverb for set_effect.
func _ensure_bus() -> void:
	if _music_bus != "":
		return
	var i := AudioServer.bus_count
	AudioServer.add_bus(i)
	_music_bus = "AdaptiveMusic%d" % get_instance_id()
	AudioServer.set_bus_name(i, _music_bus)
	AudioServer.set_bus_send(i, bus)
	_lowpass = AudioEffectLowPassFilter.new()
	_lowpass.cutoff_hz = 20000.0
	AudioServer.add_bus_effect(i, _lowpass)
	_reverb = AudioEffectReverb.new()
	_reverb.wet = 0.0
	_reverb.dry = 1.0
	_reverb.room_size = 0.7
	AudioServer.add_bus_effect(i, _reverb)

func _exit_tree() -> void:
	if _music_bus != "":
		var i := AudioServer.get_bus_index(_music_bus)
		if i >= 0:
			AudioServer.remove_bus(i)

func _ready() -> void:
	# Load the folder set in the Inspector, if it holds a song (an autoload calls load_song instead)
	if FileAccess.file_exists(music_dir.path_join("audio_manifest.json")) or FileAccess.file_exists(music_dir.path_join("music.json")):
		load_song(music_dir)

## Load the song in `dir` (a folder with audio_manifest.json in it). Stops what's playing.
func load_song(dir: String) -> void:
	if not data.is_empty():
		stop()
		stop_sfx()
	music_dir = dir
	streams = {}
	var path := music_dir.path_join("audio_manifest.json")
	if not FileAccess.file_exists(path):
		path = music_dir.path_join("music.json")
	data = JSON.parse_string(FileAccess.open(path, FileAccess.READ).get_as_text())
	intensity = float(data.get("intensity", {}).get("default", 1.0))
	for s in data.states:
		if s.get("file") != null:
			_load_loop(s.file)
		for stem in s.get("stems", []):
			_load_loop(stem.file)
		for c in s.get("costumes", []):
			if c.get("file") != null:
				_load_loop(c.file)
			for stem in c.get("stems", []):
				_load_loop(stem.file)
	for t in data.get("transitions", []):
		if t.get("file") != null:
			streams[t.file] = load(music_dir.path_join(t.file))
	for s in data.stingers:
		streams[s.file] = load(music_dir.path_join(s.file))
	for s in data.get("sfx", []):
		for f in s.files:
			var st: AudioStreamWAV = load(music_dir.path_join(f))
			if s.get("loop", false):
				st.loop_mode = AudioStreamWAV.LOOP_FORWARD
				st.loop_begin = 0
				st.loop_end = int(st.get_length() * st.mix_rate)
			streams[f] = st

func _load_loop(file: String) -> void:
	var stream: AudioStreamWAV = load(music_dir.path_join(file))
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = int(stream.get_length() * stream.mix_rate)
	streams[file] = stream

func _state(name: String) -> Dictionary:
	for s in data.states:
		if s.name == name:
			return s
	push_error("No state called %s" % name)
	return {}

## The state playing now's beat and bar (each state has its own tempo and time signature).
func _current_state() -> Dictionary:
	for s in data.states:
		if s.name == current_name:
			return s
	return {}

func _seconds_per_beat() -> float:
	var st := _current_state()
	if st.has("beatSeconds"):
		return float(st.beatSeconds) / _tempo
	return float(data.get("beatSeconds", 60.0 / float(data.bpm))) / _tempo

func _line(unit: String) -> float:
	var st := _current_state()
	var per_bar := float(st.get("beatsPerBar", data.beatsPerBar))
	return _seconds_per_beat() * (per_bar if unit == "bar" else 1.0)

## A stem group's level at the intensity now (straight lines between its curve's points).
func level(group) -> float:
	if group == null:
		return 1.0
	for g in data.get("intensity", {}).get("groups", []):
		if g.name == group:
			var c: Array = g.curve
			var x := clampf(intensity, 0.0, 1.0)
			if x <= float(c[0][0]):
				return float(c[0][1])
			for i in range(1, c.size()):
				if x <= float(c[i][0]):
					var x0 := float(c[i - 1][0])
					var x1 := float(c[i][0])
					var y0 := float(c[i - 1][1])
					var y1 := float(c[i][1])
					return y1 if x1 - x0 < 1e-9 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
			return float(c[c.size() - 1][1])
	return 1.0

## Seconds from now to the next bar (or "beat") line of the state playing now.
func time_to_next(unit := "bar") -> float:
	if _voices.is_empty() or unit == "now":
		return 0.0
	var line := _line(unit)
	var p: AudioStreamPlayer = _voices[0].player
	var pos := p.get_playback_position() + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()
	var left := line - fmod(pos, line)
	return left if left > 0.01 else left + line

## A state as the costume on now dresses it: [parts ([file, group] each), seconds, tempo].
func _dressed(s: Dictionary) -> Array:
	var src := s
	var tempo := 1.0
	if costume != "":
		for c in s.get("costumes", []):
			if c.name == costume:
				src = c
				tempo = float(c.get("tempo", 1.0))
	var parts := []
	if src.get("stems", []).size() > 0:
		for stem in src.stems:
			parts.append([stem.file, stem.group])
	else:
		parts.append([src.file, null])
	return [parts, float(src.get("seconds", s.seconds)), tempo]

func _new_player(file: String, group, fade: float, at: float) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.bus = _music_bus
	p.stream = streams[file]
	add_child(p)
	var target := linear_to_db(maxf(level(group), 0.0001))
	p.volume_db = -80.0 if fade > 0.0 else target
	p.play(at)
	if fade > 0.0:
		create_tween().tween_property(p, "volume_db", target, fade)
	return p

## Start a state, fading in over `fade` seconds, `from` (0 to 1) of the way into its loop.
func _start_state(s: Dictionary, fade := 0.0, from := 0.0) -> void:
	_ensure_bus()
	_play_id += 1
	var d := _dressed(s)
	_tempo = d[2]
	_voices = []
	current_name = s.name
	if int(s.get("shuffleBars", 0)) > 0 or s.has("gap"):
		_run_pieces(s, from, _play_id, _voices)
		return
	for part in d[0]:
		var p := _new_player(part[0], part[1], fade, fmod(from, 1.0) * float(d[1]))
		_voices.append({ "player": p, "group": part[1] })

## A pass through `n` pieces: in order, or shuffled with no piece twice running.
func _order(n: int, last: int, shuffle: bool) -> Array:
	var idx := range(n)
	if not shuffle:
		return idx
	idx.shuffle()
	if n > 1 and idx[0] == last:
		var t = idx[0]
		idx[0] = idx[1]
		idx[1] = t
	return idx

## Play a state piece by piece (shuffled, or with silences between passes) until another starts.
func _run_pieces(s: Dictionary, from: float, id: int, voices: Array) -> void:
	var bars := float(s.bars)
	var shuffle := int(s.get("shuffleBars", 0)) > 0
	var each := float(s.shuffleBars) if shuffle and float(s.shuffleBars) < bars else bars
	var count := int(ceil(bars / each - 1e-6))
	var first := mini(count - 1, int(floor(fmod(from, 1.0) * bars / each)))
	var skip := fmod(from, 1.0) * bars - first * each
	var queue := [first]
	for i in _order(count, first, shuffle):
		if i != first:
			queue.append(i)
	var last := first
	while id == _play_id:
		if queue.is_empty():
			var gap = s.get("gap")
			if gap != null:
				var wait := float(gap.min) + randf() * maxf(0.0, float(gap.max) - float(gap.min))
				await get_tree().create_timer(wait, true, false, true).timeout
				if id != _play_id:
					return
			queue = _order(count, last, shuffle)
			continue
		var k: int = queue.pop_front()
		# The costume on now dresses each piece (so a costume change comes in with the next one)
		var d := _dressed(s)
		_tempo = d[2]
		var per_bar := float(d[1]) / bars
		var a := k * each
		var b := minf(bars, a + each)
		var players := []
		for part in d[0]:
			var p := _new_player(part[0], part[1], 0.0, (a + skip) * per_bar)
			players.append(p)
			voices.append({ "player": p, "group": part[1] })
		await get_tree().create_timer((b - a - skip) * per_bar, true, false, true).timeout
		skip = 0.0
		for p in players:
			for v in voices.duplicate():
				if v.player == p:
					voices.erase(v)
			if is_instance_valid(p):
				p.queue_free()
		last = k

func _stop_voices(voices: Array, fade := 0.0) -> void:
	for v in voices:
		if not is_instance_valid(v.player):
			continue
		var p: AudioStreamPlayer = v.player
		if fade > 0.0:
			var t := create_tween()
			t.tween_property(p, "volume_db", -80.0, fade)
			t.tween_callback(p.queue_free)
		else:
			p.queue_free()

## Start a state at once.
func play(name: String) -> void:
	stop()
	_start_state(_state(name))

func _rule(to: String) -> Dictionary:
	for r in data.get("transitions", []):
		if r.from == current_name and r.to == to:
			return r
	for r in data.get("transitions", []):
		if r.from == "*" and r.to == to:
			return r
	return { "kind": "cut" }

## Move to another state the way the transition rules say (cut, crossfade, stinger, fill, riser, impact).
func set_state(name: String, unit := "") -> void:
	if current_name == "":
		play(name)
		return
	if name == current_name:
		return
	var s := _state(name)
	var r := _rule(name)
	var q: String = unit if unit != "" else String(r.get("quantize", "bar"))
	var line := _line("beat" if q == "beat" else "bar")
	var wait := time_to_next(q)
	var lead := float(r.get("leadInSeconds", 0.0))
	while wait < lead:
		wait += line
	_pending = name
	if r.get("file") != null:
		_play_once_after(streams[r.file], wait - lead)
	var bridge := 0.0
	if r.kind == "stinger":
		for st in data.stingers:
			if st.name == r.get("stinger", ""):
				_play_once_after(streams[st.file], wait)
				bridge = float(st.get("bridgeSeconds", float(st.get("bridgeBars", 1)) * _line("bar")))
	if wait > 0.0:
		await get_tree().create_timer(wait, true, false, true).timeout
	if _pending != name:
		return
	var old := _voices
	if r.kind == "crossfade":
		var fade := float(r.get("beats", 4)) * _seconds_per_beat()
		_stop_voices(old, fade)
		_start_state(s, fade)
		return
	_stop_voices(old)
	_voices = []
	if bridge > 0.0:
		await get_tree().create_timer(bridge, true, false, true).timeout
		if _pending != name:
			return
	_start_state(s)

## The names of the costumes (the same music played other ways).
func costume_names() -> Array:
	var out := []
	for s in data.states:
		for c in s.get("costumes", []):
			if not out.has(c.name):
				out.append(c.name)
	return out

## Play the music in a costume ("" : as written), crossfading over `seconds` from the same point in
## the loop. Every later state wears it too. (A state played in pieces changes at its next piece.)
func set_costume(name: String, seconds := 1.0) -> void:
	if name != "" and not costume_names().has(name):
		push_error("No costume called %s" % name)
		return
	if name == costume:
		return
	var old_len := 0.0
	if current_name != "":
		old_len = float(_dressed(_state(current_name))[1])
	costume = name
	if current_name == "" or _voices.is_empty():
		return
	var s := _state(current_name)
	if int(s.get("shuffleBars", 0)) > 0 or s.has("gap"):
		return
	var p: AudioStreamPlayer = _voices[0].player
	var from := fmod(p.get_playback_position(), old_len) / old_len if old_len > 0.0 else 0.0
	var old := _voices
	_stop_voices(old, seconds)
	_start_state(s, seconds, from)

## Shape the music for what's going on: "underwater", "muffled", "lowHealth", "dream" or "none",
## over `seconds`. Sound effects aren't touched.
func set_effect(name: String, seconds := 1.0) -> void:
	if not EFFECTS.has(name):
		push_error("No effect called %s" % name)
		return
	var e: Array = EFFECTS[name]
	_glide_effect(e[0], e[1], e[2], seconds)

## The music through a low-pass at `hz` (20000: open), gliding over `seconds`.
func set_filter(hz: float, seconds := 0.5) -> void:
	_ensure_bus()
	_glide_effect(hz, _reverb.wet / 0.6, _effect_level, seconds)

## How much of the music goes to the room reverb, 0 to 1, over `seconds`.
func set_reverb(amount: float, seconds := 0.5) -> void:
	_ensure_bus()
	_glide_effect(_lowpass.cutoff_hz, amount, _effect_level, seconds)

func _glide_effect(hz: float, wet: float, lvl: float, seconds: float) -> void:
	_ensure_bus()
	if _effect_tween != null and _effect_tween.is_valid():
		_effect_tween.kill()
	_effect_tween = create_tween().set_parallel(true)
	_effect_tween.tween_property(_lowpass, "cutoff_hz", clampf(hz, 40.0, 20000.0), maxf(0.01, seconds)).set_trans(Tween.TRANS_EXPO)
	_effect_tween.tween_property(_reverb, "wet", clampf(wet, 0.0, 1.0) * 0.6, maxf(0.01, seconds))
	_effect_tween.tween_method(_set_level, _effect_level, lvl, maxf(0.01, seconds))

func _set_level(v: float) -> void:
	_effect_level = v
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index(_music_bus), linear_to_db(maxf(v, 0.0001)))

## Crossfade the stem groups to `value` (0 to 1) along their curves, over `seconds`.
func set_intensity(value: float, seconds := 0.5) -> void:
	intensity = clampf(value, 0.0, 1.0)
	for v in _voices:
		if not is_instance_valid(v.player):
			continue
		if v.group != null:
			create_tween().tween_property(v.player, "volume_db", linear_to_db(maxf(level(v.group), 0.0001)), seconds)

## Play a stinger over the music on the next beat (or "bar", or "now").
func stinger(name: String, unit := "") -> void:
	for s in data.stingers:
		if s.name == name:
			var when: String = unit if unit != "" else String(s.get("quantize", "beat"))
			_play_once_after(streams[s.file], time_to_next(when))
			return
	push_error("No stinger called %s" % name)

func _play_once_after(stream: AudioStream, seconds: float) -> void:
	if seconds > 0.0:
		await get_tree().create_timer(seconds, true, false, true).timeout
	_ensure_bus()
	var p := AudioStreamPlayer.new()
	p.bus = _music_bus
	p.stream = stream
	add_child(p)
	p.finished.connect(p.queue_free)
	p.play()

var _last_sfx := {}

## The names of the kit's sound effects.
func sfx_names() -> Array:
	var out := []
	for s in data.get("sfx", []):
		out.append(s.name)
	return out

## Play a sound effect now: one of its variations, never the same one twice in a row. Returns its
## player: a looping sound plays until you call stop() on it (or stop_sfx). `pitch_semitones` moves it.
func play_sfx(name: String, volume_db := 0.0, pitch_semitones := 0.0) -> AudioStreamPlayer:
	for s in data.get("sfx", []):
		if s.name == name:
			var n: int = s.files.size()
			var i := randi() % n
			if n > 1 and i == int(_last_sfx.get(name, -1)):
				i = (i + 1) % n
			_last_sfx[name] = i
			var p := AudioStreamPlayer.new()
			p.bus = sfx_bus
			p.stream = streams[s.files[i]]
			p.volume_db = volume_db
			p.pitch_scale = pow(2.0, pitch_semitones / 12.0)
			p.set_meta("sfx", name)
			add_child(p)
			if not s.get("loop", false):
				p.finished.connect(p.queue_free)
			p.play()
			return p
	push_error("No sound effect called %s" % name)
	return null

## Stop every playing sound effect called `name` (or all of them, with "").
func stop_sfx(name := "") -> void:
	for c in get_children():
		if c is AudioStreamPlayer and c.has_meta("sfx") and (name == "" or c.get_meta("sfx") == name):
			c.stop()
			c.queue_free()

func stop() -> void:
	_play_id += 1
	_pending = ""
	_stop_voices(_voices)
	_voices = []
	current_name = ""
