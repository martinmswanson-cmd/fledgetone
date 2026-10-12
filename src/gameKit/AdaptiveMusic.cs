// Adaptive music player for Unity, from Bo's Beatbox.
//
// 1. Copy this folder into Assets/Resources/Music/ (audio_manifest.json becomes a TextAsset, the WAVs AudioClips).
// 2. Add this component to a GameObject. In the Inspector, leave Resources Folder as "Music".
// 3. music.Play("Explore"); music.SetState("Combat"); music.SetIntensity(0.8f); music.Stinger("Victory");
//
// Every state is a seamless loop exactly a whole number of bars long (and, when the song has stem
// groups, a set of stems of that length). Changes are scheduled on the audio clock
// (AudioSettings.dspTime) with PlayScheduled, so they land on the beat to the sample.
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class AdaptiveMusic : MonoBehaviour
{
    [Serializable] public class Stem { public string group; public string file; }
    [Serializable] public class State { public string name; public string file; public double bars; public double seconds; public Stem[] stems; }
    [Serializable] public class Rule { public string from; public string to; public string kind; public string quantize; public double beats; public string file; public double leadInSeconds; public string stinger; }
    [Serializable] public class StingerInfo { public string name; public string kind; public string file; public string quantize; public double bridgeBars; }
    [Serializable] public class Point { public float x; public float y; }
    [Serializable] public class Group { public string name; public Point[] points; }
    [Serializable] public class Intensity { public float @default = 1f; public Group[] groups; }
    [Serializable] public class MusicData { public string name; public double bpm; public int beatsPerBar; public string key; public Intensity intensity; public State[] states; public Rule[] transitions; public StingerInfo[] stingers; }

    public string resourcesFolder = "Music";
    [UnityEngine.Range(0f, 1f)] public float volume = 1f;

    public MusicData Data { get; private set; }
    public string Current { get; private set; }
    public float IntensityNow { get; private set; } = 1f;

    readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
    class Voice { public AudioSource source; public string group; public float fade = 1f; }
    List<Voice> voices = new List<Voice>();
    double startDsp;
    Coroutine glide;

    void Awake()
    {
        var json = Resources.Load<TextAsset>(resourcesFolder + "/audio_manifest");
        // JsonUtility can't read the curves' [x, y] pairs: turn them into {"x":..,"y":..} first
        var text = System.Text.RegularExpressions.Regex.Replace(json.text, @"\[\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\]", "{\"x\":$1,\"y\":$2}");
        text = text.Replace("\"curve\":", "\"points\":");
        Data = JsonUtility.FromJson<MusicData>(text);
        IntensityNow = Data.intensity != null ? Data.intensity.@default : 1f;
    }

    AudioClip Clip(string file)
    {
        if (!clips.TryGetValue(file, out var clip))
        {
            var path = resourcesFolder + "/" + System.IO.Path.ChangeExtension(file, null);
            clip = Resources.Load<AudioClip>(path);
            if (clip == null) Debug.LogError("AdaptiveMusic: missing " + path);
            clips[file] = clip;
        }
        return clip;
    }

    State Find(string name)
    {
        foreach (var s in Data.states) if (s.name == name) return s;
        throw new ArgumentException("No state called " + name);
    }

    double SecondsPerBeat => 60.0 / Data.bpm;
    double Line(string unit) => SecondsPerBeat * (unit == "bar" ? Data.beatsPerBar : 1);

    /// A stem group's level at the intensity now (straight lines between its curve's points).
    public float Level(string group)
    {
        if (string.IsNullOrEmpty(group) || Data.intensity == null || Data.intensity.groups == null) return 1f;
        foreach (var g in Data.intensity.groups)
        {
            if (g.name != group || g.points == null || g.points.Length == 0) continue;
            float x = Mathf.Clamp01(IntensityNow);
            var c = g.points;
            if (x <= c[0].x) return c[0].y;
            for (int i = 1; i < c.Length; i++)
                if (x <= c[i].x) return c[i].x - c[i - 1].x < 1e-6f ? c[i].y : Mathf.Lerp(c[i - 1].y, c[i].y, (x - c[i - 1].x) / (c[i].x - c[i - 1].x));
            return c[c.Length - 1].y;
        }
        return 1f;
    }

    /// The dspTime of the next bar (or "beat") line of the state playing now.
    public double NextLine(string unit = "bar")
    {
        double now = AudioSettings.dspTime + 0.05;
        if (Current == null || unit == "now") return now;
        double line = Line(unit);
        if (now < startDsp) return startDsp;
        return startDsp + Math.Ceiling((now - startDsp) / line - 1e-6) * line;
    }

    List<Voice> StartState(State s, double at)
    {
        var list = new List<Voice>();
        var parts = new List<Stem>();
        if (s.stems != null && s.stems.Length > 0) parts.AddRange(s.stems);
        else parts.Add(new Stem { group = null, file = s.file });
        foreach (var part in parts)
        {
            var src = gameObject.AddComponent<AudioSource>();
            src.clip = Clip(part.file);
            src.loop = true;
            src.playOnAwake = false;
            src.volume = volume * Level(part.group);
            src.PlayScheduled(at);
            list.Add(new Voice { source = src, group = part.group });
        }
        startDsp = at;
        Current = s.name;
        return list;
    }

    void StopVoices(List<Voice> list, double at)
    {
        foreach (var v in list)
        {
            v.source.SetScheduledEndTime(at);
            Destroy(v.source, (float)(at - AudioSettings.dspTime) + 0.5f);
        }
    }

    /// Start a state at once.
    public void Play(string name)
    {
        Stop();
        voices = StartState(Find(name), AudioSettings.dspTime + 0.1);
    }

    Rule RuleFor(string to)
    {
        if (Data.transitions != null)
        {
            foreach (var r in Data.transitions) if (r.from == Current && r.to == to) return r;
            foreach (var r in Data.transitions) if (r.from == "*" && r.to == to) return r;
        }
        return new Rule { kind = "cut" };
    }

    /// Move to another state the way the transition rules say (cut, crossfade, stinger, fill, riser, impact).
    public void SetState(string name, string unit = null)
    {
        if (Current == null) { Play(name); return; }
        if (name == Current) return;
        var s = Find(name);
        var r = RuleFor(name);
        string q = unit ?? (string.IsNullOrEmpty(r.quantize) ? "bar" : r.quantize);
        double line = Line(q == "beat" ? "beat" : "bar");
        double at = NextLine(q);
        double lead = r.leadInSeconds;
        while (at - AudioSettings.dspTime < lead + 0.05) at += line;
        var old = voices;
        if (r.kind == "crossfade")
        {
            double fade = (r.beats > 0 ? r.beats : 4) * SecondsPerBeat;
            voices = StartState(s, at);
            foreach (var v in voices) v.fade = 0f;
            StartCoroutine(Crossfade(old, voices, at, fade));
            return;
        }
        if (!string.IsNullOrEmpty(r.file)) PlayOnce(r.file, at - lead);
        double startAt = at;
        if (r.kind == "stinger" && Data.stingers != null)
            foreach (var st in Data.stingers)
                if (st.name == r.stinger) { PlayOnce(st.file, at); startAt = at + (st.bridgeBars > 0 ? st.bridgeBars : 1) * Line("bar"); }
        StopVoices(old, at);
        voices = StartState(s, startAt);
    }

    IEnumerator Crossfade(List<Voice> from, List<Voice> to, double at, double fade)
    {
        while (AudioSettings.dspTime < at + fade)
        {
            float k = (float)Math.Max(0, Math.Min(1, (AudioSettings.dspTime - at) / fade));
            foreach (var v in from) { v.fade = 1f - k; v.source.volume = volume * Level(v.group) * v.fade; }
            foreach (var v in to) { v.fade = k; v.source.volume = volume * Level(v.group) * v.fade; }
            yield return null;
        }
        foreach (var v in to) { v.fade = 1f; v.source.volume = volume * Level(v.group); }
        StopVoices(from, AudioSettings.dspTime);
    }

    /// Crossfade the stem groups to `value` (0 to 1) along their curves, over `seconds`.
    public void SetIntensity(float value, float seconds = 0.5f)
    {
        IntensityNow = Mathf.Clamp01(value);
        if (glide != null) StopCoroutine(glide);
        glide = StartCoroutine(Glide(seconds));
    }

    IEnumerator Glide(float seconds)
    {
        var start = new Dictionary<Voice, float>();
        foreach (var v in voices) start[v] = v.source.volume;
        for (float t = 0; t < seconds; t += Time.unscaledDeltaTime)
        {
            foreach (var v in voices) v.source.volume = Mathf.Lerp(start[v], volume * Level(v.group) * v.fade, t / seconds);
            yield return null;
        }
        foreach (var v in voices) v.source.volume = volume * Level(v.group) * v.fade;
    }

    /// Play a stinger over the music on the next beat (or "bar", or "now").
    public void Stinger(string name, string unit = null)
    {
        foreach (var s in Data.stingers)
        {
            if (s.name != name) continue;
            string when = unit ?? (string.IsNullOrEmpty(s.quantize) ? "beat" : s.quantize);
            PlayOnce(s.file, NextLine(when));
            return;
        }
        throw new ArgumentException("No stinger called " + name);
    }

    void PlayOnce(string file, double at)
    {
        var src = gameObject.AddComponent<AudioSource>();
        src.clip = Clip(file);
        src.volume = volume;
        src.PlayScheduled(Math.Max(at, AudioSettings.dspTime));
        Destroy(src, (float)(at - AudioSettings.dspTime) + src.clip.length + 0.5f);
    }

    public void Stop()
    {
        foreach (var v in voices) Destroy(v.source);
        voices = new List<Voice>();
        Current = null;
    }
}
