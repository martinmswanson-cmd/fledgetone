// Try the music and sound effects: add this component to an empty GameObject and press Play.
// From Bo's Beatbox. Buttons for every state, an intensity slider, the stingers and the sound
// effects. In your own game, call AdaptiveMusic the same way (see AdaptiveMusic.cs).
using System.Collections.Generic;
using UnityEngine;

[RequireComponent(typeof(AdaptiveMusic))]
public class AdaptiveMusicExample : MonoBehaviour
{
    AdaptiveMusic music;
    float level = 1f;
    Vector2 scroll;
    readonly Dictionary<string, AudioSource> loops = new Dictionary<string, AudioSource>();

    void Start()
    {
        music = GetComponent<AdaptiveMusic>();
        level = music.IntensityNow;
        if (music.Data.states.Length > 0) music.Play(music.Data.states[0].name);
    }

    void OnGUI()
    {
        GUILayout.BeginArea(new Rect(16, 16, 360, Screen.height - 32));
        scroll = GUILayout.BeginScrollView(scroll);
        GUILayout.Label(music.Data.name + "   (state: " + music.Current + ")");
        GUILayout.Label("States");
        foreach (var s in music.Data.states) if (GUILayout.Button(s.name)) music.SetState(s.name);
        if (music.Data.intensity != null && music.Data.intensity.groups != null && music.Data.intensity.groups.Length > 0)
        {
            GUILayout.Label("Intensity " + Mathf.RoundToInt(level * 100) + "%");
            float next = GUILayout.HorizontalSlider(level, 0f, 1f);
            if (Mathf.Abs(next - level) > 0.001f) { level = next; music.SetIntensity(level); }
        }
        if (music.Data.stingers != null && music.Data.stingers.Length > 0)
        {
            GUILayout.Label("Stingers");
            foreach (var s in music.Data.stingers) if (GUILayout.Button("★ " + s.name)) music.Stinger(s.name);
        }
        if (music.Data.sfx != null && music.Data.sfx.Length > 0)
        {
            GUILayout.Label("Sound effects");
            foreach (var s in music.Data.sfx)
            {
                bool on = loops.ContainsKey(s.name);
                if (!GUILayout.Button((s.loop ? (on ? "■ " : "↻ ") : "▶ ") + s.name)) continue;
                if (on) { music.StopSfx(s.name); loops.Remove(s.name); }
                else
                {
                    var src = music.PlaySfx(s.name, 1f, Random.Range(-0.3f, 0.3f));
                    if (s.loop) loops[s.name] = src;
                }
            }
        }
        if (GUILayout.Button("Stop")) { music.Stop(); music.StopSfx(); loops.Clear(); }
        GUILayout.EndScrollView();
        GUILayout.EndArea();
    }
}
