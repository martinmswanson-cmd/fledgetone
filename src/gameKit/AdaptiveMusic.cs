// Adaptive music player for Unity, from Bo's Beatbox.
//
// 1. Copy this folder into Assets/Resources/Music/ (music.json becomes a TextAsset, the WAVs AudioClips).
// 2. Add this component to a GameObject. In the Inspector, leave Resources Folder as "Music".
// 3. music.Play("Explore"); music.SetState("Combat"); music.Stinger("Victory");
//
// Every state is a seamless loop exactly a whole number of bars long. Changes are scheduled on the
// audio clock (AudioSettings.dspTime) with PlayScheduled, so they land on the beat to the sample.
using System;
using System.Collections.Generic;
using UnityEngine;

public class AdaptiveMusic : MonoBehaviour
{
    [Serializable] public class Transition { public string kind; public string file; public double leadInSeconds; }
    [Serializable] public class State { public string name; public string file; public double bars; public double seconds; public Transition transition; }
    [Serializable] public class StingerInfo { public string name; public string kind; public string file; public string quantize; }
    [Serializable] public class MusicData { public string name; public double bpm; public int beatsPerBar; public string key; public State[] states; public StingerInfo[] stingers; }

    public string resourcesFolder = "Music";
    [UnityEngine.Range(0f, 1f)] public float volume = 1f;

    public MusicData Data { get; private set; }
    public string Current { get; private set; }

    readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
    readonly AudioSource[] loops = new AudioSource[2];
    int active;
    double startDsp;

    void Awake()
    {
        var json = Resources.Load<TextAsset>(resourcesFolder + "/music");
        Data = JsonUtility.FromJson<MusicData>(json.text);
        for (int i = 0; i < 2; i++)
        {
            loops[i] = gameObject.AddComponent<AudioSource>();
            loops[i].loop = true;
            loops[i].playOnAwake = false;
        }
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

    /// The dspTime of the next bar (or "beat") line of the state playing now.
    public double NextLine(string unit = "bar")
    {
        double now = AudioSettings.dspTime + 0.05;
        if (Current == null) return now;
        double line = SecondsPerBeat * (unit == "bar" ? Data.beatsPerBar : 1);
        return startDsp + Math.Ceiling((now - startDsp) / line - 1e-6) * line;
    }

    /// Start a state at once.
    public void Play(string name)
    {
        Stop();
        var s = Find(name);
        startDsp = AudioSettings.dspTime + 0.1;
        loops[active].clip = Clip(s.file);
        loops[active].volume = volume;
        loops[active].PlayScheduled(startDsp);
        Current = name;
    }

    /// Move to another state on the next bar (or "beat"), with its transition.
    public void SetState(string name, string unit = "bar")
    {
        if (Current == null) { Play(name); return; }
        if (name == Current) return;
        var s = Find(name);
        double line = SecondsPerBeat * (unit == "bar" ? Data.beatsPerBar : 1);
        double at = NextLine(unit);
        double lead = s.transition != null && !string.IsNullOrEmpty(s.transition.file) ? s.transition.leadInSeconds : 0;
        while (at - AudioSettings.dspTime < lead + 0.05) at += line;
        if (lead > 0 || (s.transition != null && !string.IsNullOrEmpty(s.transition.file))) PlayOnce(s.transition.file, at - lead);
        loops[active].SetScheduledEndTime(at);
        active = 1 - active;
        loops[active].clip = Clip(s.file);
        loops[active].volume = volume;
        loops[active].PlayScheduled(at);
        startDsp = at;
        Current = name;
    }

    /// Play a stinger over the music on the next beat (or "bar", or "now").
    public void Stinger(string name, string unit = null)
    {
        foreach (var s in Data.stingers)
        {
            if (s.name != name) continue;
            string when = unit ?? (string.IsNullOrEmpty(s.quantize) ? "beat" : s.quantize);
            PlayOnce(s.file, when == "now" ? AudioSettings.dspTime + 0.02 : NextLine(when));
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
        foreach (var l in loops) l.Stop();
        Current = null;
    }
}
