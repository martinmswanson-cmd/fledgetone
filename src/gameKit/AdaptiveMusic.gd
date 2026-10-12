# Adaptive music player for Godot 4, from Bo's Beatbox.
#
# 1. Copy this folder (music.json, states/, stingers/, transitions/) into your project, e.g. res://music/.
# 2. Add this script to a Node (or make it an autoload called Music) and set music_dir.
# 3. Music.play("Explore"); Music.set_state("Combat"); Music.stinger("Victory")
#
# Every state is a seamless loop exactly a whole number of bars long, so switching on a bar line
# keeps the beat. Switches are timed from the audio playback position, accurate to about a frame.
extends Node

@export var music_dir := "res://music/"
@export var bus := "Master"

var data := {}
var streams := {}
var current_name := ""
var _players: Array[AudioStreamPlayer] = []
var _active := 0
var _pending := ""

func _ready() -> void:
	var f := FileAccess.open(music_dir.path_join("music.json"), FileAccess.READ)
	data = JSON.parse_string(f.get_as_text())
	for s in data.states:
		var stream: AudioStreamWAV = load(music_dir.path_join(s.file))
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		stream.loop_end = int(stream.get_length() * stream.mix_rate)
		streams[s.file] = stream
		if s.get("transition") != null:
			streams[s.transition.file] = load(music_dir.path_join(s.transition.file))
	for s in data.stingers:
		streams[s.file] = load(music_dir.path_join(s.file))
	for i in 2:
		var p := AudioStreamPlayer.new()
		p.bus = bus
		add_child(p)
		_players.append(p)

func _state(name: String) -> Dictionary:
	for s in data.states:
		if s.name == name:
			return s
	push_error("No state called %s" % name)
	return {}

func _seconds_per_beat() -> float:
	return 60.0 / float(data.bpm)

## Seconds from now to the next bar (or "beat") line of the state playing now.
func time_to_next(unit := "bar") -> float:
	var p := _players[_active]
	if not p.playing:
		return 0.0
	var line := _seconds_per_beat() * (float(data.beatsPerBar) if unit == "bar" else 1.0)
	var pos := p.get_playback_position() + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()
	var left := line - fmod(pos, line)
	return left if left > 0.01 else left + line

## Start a state at once.
func play(name: String) -> void:
	var s := _state(name)
	for p in _players:
		p.stop()
	_players[_active].stream = streams[s.file]
	_players[_active].play()
	current_name = name

## Move to another state on the next bar (or "beat"), with its transition.
func set_state(name: String, unit := "bar") -> void:
	if current_name == "":
		play(name)
		return
	if name == current_name:
		return
	var s := _state(name)
	var line := _seconds_per_beat() * (float(data.beatsPerBar) if unit == "bar" else 1.0)
	var wait := time_to_next(unit)
	var lead := 0.0
	if s.get("transition") != null:
		lead = float(s.transition.leadInSeconds)
	while wait < lead:
		wait += line
	_pending = name
	if lead > 0.0 or s.get("transition") != null:
		_play_once_after(streams[s.transition.file], wait - lead)
	await get_tree().create_timer(wait, true, false, true).timeout
	if _pending != name:
		return
	var old := _players[_active]
	_active = 1 - _active
	_players[_active].stream = streams[s.file]
	_players[_active].play()
	old.stop()
	current_name = name

## Play a stinger over the music on the next beat (or "bar", or "now").
func stinger(name: String, unit := "") -> void:
	for s in data.stingers:
		if s.name == name:
			var when := "now" if unit == "now" else (unit if unit != "" else String(s.get("quantize", "beat")))
			_play_once_after(streams[s.file], 0.0 if when == "now" else time_to_next(when))
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
	for p in _players:
		p.stop()
	current_name = ""
