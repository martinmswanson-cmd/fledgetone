# Try the music and sound effects: run this scene (F6). From Fledgetone.
#
#   1 to 9      switch to that state (the way the song's transition rules say)
#   Up / Down   intensity up or down (the stem groups crossfade along their curves)
#   Space       the first stinger (Shift+Space the next one)
#   A to Z      play a sound effect (looping ones play until you press the key again)
#   Esc         stop
#
# In your own game, call the Music node the same way: see AdaptiveMusic.gd.
extends Node

@onready var music: Node = $Music
@onready var help: Label = $Help

var states: Array = []
var stingers: Array = []
var sfx: Array = []
var level := 1.0
var stinger_at := 0
var loops := {}

func _ready() -> void:
	for s in music.data.states:
		states.append(s.name)
	for s in music.data.stingers:
		stingers.append(s.name)
	sfx = music.sfx_names()
	level = music.intensity
	_show()
	if states.size() > 0:
		music.play(states[0])
		_show()

func _show() -> void:
	var lines := ["%s   (state: %s, intensity %d%%)" % [music.data.name, music.current_name, roundi(level * 100)], ""]
	for i in mini(states.size(), 9):
		lines.append("%d  %s" % [i + 1, states[i]])
	lines.append("Up / Down  intensity")
	if stingers.size() > 0:
		lines.append("Space  stinger: %s" % stingers[stinger_at % stingers.size()])
	for i in mini(sfx.size(), 26):
		lines.append("%s  %s" % [char(65 + i), sfx[i]])
	lines.append("Esc  stop")
	help.text = "\n".join(lines)

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	var k: int = event.keycode
	if k >= KEY_1 and k <= KEY_9 and k - KEY_1 < states.size():
		music.set_state(states[k - KEY_1])
	elif k == KEY_UP or k == KEY_DOWN:
		level = clampf(level + (0.1 if k == KEY_UP else -0.1), 0.0, 1.0)
		music.set_intensity(level)
	elif k == KEY_SPACE and stingers.size() > 0:
		if event.shift_pressed:
			stinger_at += 1
		music.stinger(stingers[stinger_at % stingers.size()])
	elif k >= KEY_A and k <= KEY_Z and k - KEY_A < sfx.size():
		var name: String = sfx[k - KEY_A]
		if loops.has(name):
			music.stop_sfx(name)
			loops.erase(name)
		else:
			var p: AudioStreamPlayer = music.play_sfx(name, 0.0, randf_range(-0.3, 0.3))
			if p != null and p.stream is AudioStreamWAV and (p.stream as AudioStreamWAV).loop_mode != AudioStreamWAV.LOOP_DISABLED:
				loops[name] = p
	elif k == KEY_ESCAPE:
		music.stop()
		music.stop_sfx()
		loops.clear()
	# A frame later, so the state shown is the new one
	await get_tree().process_frame
	_show()
