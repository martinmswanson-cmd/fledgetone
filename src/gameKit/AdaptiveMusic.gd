# Adaptive music player for Godot 4, from Bo's Beatbox.
#
# 1. Copy this folder (audio_manifest.json, states/, stems/, stingers/, transitions/) into your
#    project, e.g. res://music/.
# 2. Add this script to a Node (or make it an autoload called Music) and set music_dir.
# 3. Music.play("Explore"); Music.set_state("Combat"); Music.set_intensity(0.8); Music.stinger("Victory")
#
# Every state is a seamless loop exactly a whole number of bars long (and, when the song has stem
# groups, a set of stems of that length), so switching on a bar line keeps the beat. Switches are
# timed from the audio playback position, accurate to about a frame.
extends Node

@export var music_dir := "res://music/"
@export var bus := "Master"

var data := {}
var streams := {}
var current_name := ""
var intensity := 1.0
## The state playing now: its players (one per stem, or one for the mix) and their stem groups
var _voices: Array = []
var _pending := ""

func _ready() -> void:
	var path := music_dir.path_join("audio_manifest.json")
	if not FileAccess.file_exists(path):
		path = music_dir.path_join("music.json")
	data = JSON.parse_string(FileAccess.open(path, FileAccess.READ).get_as_text())
	intensity = float(data.get("intensity", {}).get("default", 1.0))
	for s in data.states:
		_load_loop(s.file)
		for stem in s.get("stems", []):
			_load_loop(stem.file)
	for t in data.get("transitions", []):
		if t.get("file") != null:
			streams[t.file] = load(music_dir.path_join(t.file))
	for s in data.stingers:
		streams[s.file] = load(music_dir.path_join(s.file))

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
		return float(st.beatSeconds)
	return float(data.get("beatSeconds", 60.0 / float(data.bpm)))

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

func _start_state(s: Dictionary, fade := 0.0) -> void:
	var parts := []
	if s.get("stems", []).size() > 0:
		for stem in s.stems:
			parts.append([stem.file, stem.group])
	else:
		parts.append([s.file, null])
	_voices = []
	for part in parts:
		var p := AudioStreamPlayer.new()
		p.bus = bus
		p.stream = streams[part[0]]
		add_child(p)
		var target := linear_to_db(maxf(level(part[1]), 0.0001))
		p.volume_db = -80.0 if fade > 0.0 else target
		p.play()
		if fade > 0.0:
			create_tween().tween_property(p, "volume_db", target, fade)
		_voices.append({ "player": p, "group": part[1] })
	current_name = s.name

func _stop_voices(voices: Array, fade := 0.0) -> void:
	for v in voices:
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

## Crossfade the stem groups to `value` (0 to 1) along their curves, over `seconds`.
func set_intensity(value: float, seconds := 0.5) -> void:
	intensity = clampf(value, 0.0, 1.0)
	for v in _voices:
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
	var p := AudioStreamPlayer.new()
	p.bus = bus
	p.stream = stream
	add_child(p)
	p.finished.connect(p.queue_free)
	p.play()

func stop() -> void:
	_pending = ""
	_stop_voices(_voices)
	_voices = []
	current_name = ""
