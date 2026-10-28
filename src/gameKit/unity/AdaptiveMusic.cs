// Adaptive music player for Unity, from Fledgetone.
//
// 1. Copy this folder into Assets/Resources/Music/ (audio_manifest.json becomes a TextAsset, the WAVs AudioClips).
// 2. Add this component to a GameObject. In the Inspector, leave Resources Folder as "Music".
// 3. music.Play("Explore"); music.SetState("Combat"); music.SetIntensity(0.8f); music.Stinger("Victory");
// 4. Sound effects: music.PlaySfx("sword_hit") plays a different variation each time;
//    var rain = music.PlaySfx("rain") loops until music.StopSfx("rain") (or Destroy(rain)).
// 5. music.SetCostume("8-bit") plays the same music another way from the same point (null: back);
//    music.SetEffect("underwater") muffles it ("muffled", "lowHealth", "dream", "none").
// 6. music.SetParameter("danger", 0.7f) sets one of the song's parameters (0 to 1): whatever it was
//    set up to move (the intensity, a filter, the reverb, the volume, a layer) follows.
//
// Every state is a seamless loop exactly a whole number of bars long (and, when the song has stem
// groups, a set of stems of that length). A state can also play its pieces in a shuffled order or
// leave silences between plays (shuffleBars and gap in the manifest). Changes are scheduled on the
// audio clock (AudioSettings.dspTime) with PlayScheduled, so they land on the beat to the sample.
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class AdaptiveMusic : MonoBehaviour
{
    [Serializable] public class Stem { public string group; public string file; }
    [Serializable] public class Costume { public string name; public double tempo = 1; public string file; public double seconds; public Stem[] stems; }
    [Serializable] public class Gap { public double min; public double max; }
    [Serializable] public class State { public string name; public string file; public double bars; public double seconds; public double beatSeconds; public int beatsPerBar; public Stem[] stems; public Costume[] costumes; public int shuffleBars; public Gap gap; public double[] barTimes; public double[] beatTimes; }
    [Serializable] public class Rule { public string from; public string to; public string kind; public string quantize; public int phraseBars; public double beats; public string file; public double leadInSeconds; public string stinger; public double bridgeSeconds; }
    [Serializable] public class StingerInfo { public string name; public string kind; public string file; public string quantize; public double bridgeBars; public double bridgeSeconds; }
    [Serializable] public class Point { public float x; public float y; }
    [Serializable] public class Group { public string name; public Point[] points; }
    [Serializable] public class Intensity { public float @default = 1f; public Group[] groups; }
    [Serializable] public class SfxInfo { public string name; public string[] files; public bool loop; public double seconds; }
    [Serializable] public class ParamTarget { public string target; public string group; public float from; public float to = 1f; public float start; public float end; }
    [Serializable] public class Parameter { public string name; public float @default; public ParamTarget[] targets; }
    [Serializable] public class MusicData { public string name; public double bpm; public int beatsPerBar; public double beatSeconds; public string key; public Intensity intensity; public Parameter[] parameters; public State[] states; public Rule[] transitions; public StingerInfo[] stingers; public SfxInfo[] sfx; }

    public string resourcesFolder = "Music";
    [UnityEngine.Range(0f, 1f)] public float volume = 1f;
    [UnityEngine.Range(0f, 1f)] public float sfxVolume = 1f;

    public MusicData Data { get; private set; }
    public string Current { get; private set; }
    public float IntensityNow { get; private set; } = 1f;
    /// The costume on now (null: as written)
    public string CostumeNow { get; private set; }

    readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
    class Voice { public AudioSource source; public string group; public float fade = 1f; public double end = double.MaxValue; }
    List<Voice> voices = new List<Voice>();
    double startDsp;
    double tempoNow = 1;
    // When the state playing (or waiting) started (or starts)
    double stateStart;
    Coroutine glide;
    // Music plays on a child object with its own filters, so effects leave sound effects alone
    GameObject musicObject;
    AudioLowPassFilter lowPass;
    AudioReverbFilter reverb;
    float effectLevel = 1f;
    Coroutine effectGlide;
    // The filter, reverb and level as SetFilter, SetReverb and SetEffect last left them
    float baseFilter = 22000f, baseReverb = 0f, baseLevel = 1f;
    // The song's parameters (name -> 0 to 1): see SetParameter
    readonly Dictionary<string, float> parameters = new Dictionary<string, float>();
    // A state played piece by piece (shuffled, or with silences): its scheduler and where pieces start
    Coroutine pieces;
    // A state played in pieces that's crossfading out keeps its pieces coming until the fade ends (by play id)
    readonly Dictionary<int, double> fadeUntil = new Dictionary<int, double>();
    int playId;
    // The pieces scheduled: when each starts and ends, and where it starts in the loop
    readonly List<double[]> pieceTimes = new List<double[]>();
    double loopSeconds = 1;

    void Awake()
    {
        musicObject = new GameObject("Adaptive music");
        musicObject.transform.SetParent(transform, false);
        lowPass = musicObject.AddComponent<AudioLowPassFilter>();
        lowPass.cutoffFrequency = 22000f;
        reverb = musicObject.AddComponent<AudioReverbFilter>();
        reverb.reverbPreset = AudioReverbPreset.Off;
        var json = Resources.Load<TextAsset>(resourcesFolder + "/audio_manifest");
        // JsonUtility can't read the curves' [x, y] pairs: turn them into {"x":..,"y":..} first
        var text = System.Text.RegularExpressions.Regex.Replace(json.text, @"\[\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\]", "{\"x\":$1,\"y\":$2}");
        text = text.Replace("\"curve\":", "\"points\":");
        Data = JsonUtility.FromJson<MusicData>(text);
        IntensityNow = Data.intensity != null ? Data.intensity.@default : 1f;
        if (Data.parameters != null) foreach (var p in Data.parameters) parameters[p.name] = Mathf.Clamp01(p.@default);
        if (parameters.Count > 0) { var m = Mix(); ApplyEffect(Mathf.Min(baseFilter, m.filter), Mathf.Max(baseReverb, m.reverb), baseLevel * m.volume); }
    }

    /// What the parameters ask for together: the highest intensity and reverb, the lowest filter, the
    /// volumes and each group's levels multiplied (the same sums as Fledgetone's gameParams.ts).
    public class ParamMix { public float intensity = -1f; public float filter = 20000f; public float reverb; public float volume = 1f; public Dictionary<string, float> layers = new Dictionary<string, float>(); }

    public ParamMix Mix()
    {
        var m = new ParamMix();
        if (Data?.parameters == null) return m;
        foreach (var p in Data.parameters)
        {
            float v = parameters.TryGetValue(p.name, out var x) ? x : Mathf.Clamp01(p.@default);
            if (p.targets == null) continue;
            foreach (var t in p.targets)
            {
                float lo = Mathf.Min(t.from, t.to), hi = Mathf.Max(t.from, t.to);
                float f = hi - lo < 1e-6f ? (v >= hi ? 1f : 0f) : Mathf.Clamp01((v - lo) / (hi - lo));
                switch (t.target)
                {
                    case "filter":
                        float a = Mathf.Max(60f, t.start), b = Mathf.Max(60f, t.end);
                        m.filter = Mathf.Min(m.filter, Mathf.Clamp(a * Mathf.Pow(b / a, f), 60f, 20000f));
                        break;
                    case "intensity": m.intensity = Mathf.Max(m.intensity, Mathf.Clamp01(Mathf.Lerp(t.start, t.end, f))); break;
                    case "reverb": m.reverb = Mathf.Max(m.reverb, Mathf.Clamp01(Mathf.Lerp(t.start, t.end, f))); break;
                    case "volume": m.volume *= Mathf.Clamp01(Mathf.Lerp(t.start, t.end, f)); break;
                    case "layer":
                        if (!string.IsNullOrEmpty(t.group)) m.layers[t.group] = (m.layers.TryGetValue(t.group, out var l) ? l : 1f) * Mathf.Clamp01(Mathf.Lerp(t.start, t.end, f));
                        break;
                }
            }
        }
        return m;
    }

    /// The song's parameters' names.
    public IEnumerable<string> ParameterNames { get { if (Data.parameters != null) foreach (var p in Data.parameters) yield return p.name; } }

    public float GetParameter(string name) => parameters.TryGetValue(name, out var v) ? v : 0f;

    /// Set one of the song's parameters (0 to 1) over `seconds`: whatever it was set up to move follows.
    public void SetParameter(string name, float value, float seconds = 0.5f)
    {
        if (!parameters.ContainsKey(name)) throw new ArgumentException("No parameter called " + name);
        parameters[name] = Mathf.Clamp01(value);
        GlideMix(seconds);
        if (glide != null) StopCoroutine(glide);
        glide = StartCoroutine(Glide(seconds));
    }

    // The filter, reverb and level as the effect, SetFilter / SetReverb and the parameters have them
    void GlideMix(float seconds)
    {
        var m = Mix();
        if (effectGlide != null) StopCoroutine(effectGlide);
        effectGlide = StartCoroutine(GlideEffect(Mathf.Min(baseFilter, m.filter), Mathf.Max(baseReverb, m.reverb), baseLevel * m.volume, seconds));
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

    // The state playing now's beat and bar (each state has its own tempo and time signature)
    State CurrentState() { if (Current != null) foreach (var s in Data.states) if (s.name == Current) return s; return null; }
    double SecondsPerBeat { get { var st = CurrentState(); return (st != null && st.beatSeconds > 0 ? st.beatSeconds : Data.beatSeconds > 0 ? Data.beatSeconds : 60.0 / Data.bpm) / tempoNow; } }
    double Line(string unit) { var st = CurrentState(); return SecondsPerBeat * (unit == "bar" ? (st != null && st.beatsPerBar > 0 ? st.beatsPerBar : Data.beatsPerBar) : 1); }

    /// A stem group's level now: its curve at the intensity, times what the parameters ask of it.
    public float Level(string group)
    {
        if (string.IsNullOrEmpty(group)) return 1f;
        if (Data.parameters == null || Data.parameters.Length == 0) return CurveLevel(group, IntensityNow);
        var m = Mix();
        return CurveLevel(group, m.intensity >= 0f ? m.intensity : IntensityNow) * (m.layers.TryGetValue(group, out var l) ? l : 1f);
    }

    float CurveLevel(string group, float intensity)
    {
        if (Data.intensity == null || Data.intensity.groups == null) return 1f;
        foreach (var g in Data.intensity.groups)
        {
            if (g.name != group || g.points == null || g.points.Length == 0) continue;
            float x = Mathf.Clamp01(intensity);
            var c = g.points;
            if (x <= c[0].x) return c[0].y;
            for (int i = 1; i < c.Length; i++)
                if (x <= c[i].x) return c[i].x - c[i - 1].x < 1e-6f ? c[i].y : Mathf.Lerp(c[i - 1].y, c[i].y, (x - c[i - 1].x) / (c[i].x - c[i - 1].x));
            return c[c.Length - 1].y;
        }
        return 1f;
    }

    /// The dspTime of the next bar (or "beat") line of the state playing now.
    /// A "phrase" is `phraseBars` bars from the state's start; "end" is where its loop (or piece) comes round.
    public double NextLine(string unit = "bar", int phraseBars = 4, double ahead = 0)
    {
        double now = AudioSettings.dspTime + 0.05;
        if (Current == null || unit == "now") return now;
        double from = GridStart(now);
        if (now < from) return from;
        // A state whose tempo or time signature changes inside it: its own bar lines and beats
        var lines = GridLines(unit, phraseBars);
        if (lines != null)
        {
            double[] piece = null;
            foreach (var p in pieceTimes) if (now >= p[0] && now < p[1]) piece = p;
            double pos = piece != null ? piece[2] + (now - piece[0]) : (now - from) % loopSeconds;
            double at = now + UntilLine(lines, loopSeconds, pos, ahead);
            // (The next piece, which may be any of them, starts on a bar line)
            return piece != null && ahead <= piece[1] - now ? Math.Min(at, piece[1]) : at;
        }
        if (unit == "end")
            foreach (var p in pieceTimes) if (now >= p[0] && now < p[1]) return p[1];
        double line = LineFor(unit, phraseBars);
        return from + Math.Ceiling((now - from) / line - 1e-6) * line;
    }

    // The lines of `unit` in the state playing now (seconds into its loop, as the costume on now plays
    // it) when the manifest gives them (barTimes, beatTimes); null when one line length finds them
    List<double> GridLines(string unit, int phraseBars = 4)
    {
        var st = CurrentState();
        double[] times = st == null ? null : unit == "beat" ? st.beatTimes : unit == "bar" || unit == "phrase" ? st.barTimes : null;
        if (times == null || times.Length == 0) return null;
        var lines = new List<double>();
        for (int i = 0; i < times.Length; i++) if (unit != "phrase" || i % Math.Max(1, phraseBars) == 0) lines.Add(times[i] / tempoNow);
        return lines;
    }

    // Seconds from `pos` (seconds into a loop `loop` long) to the first of `lines` at least `ahead` on
    static double UntilLine(List<double> lines, double loop, double pos, double ahead)
    {
        double target = pos + ahead - 1e-6;
        double baseAt = Math.Floor(target / loop) * loop;
        foreach (var t in lines) if (t >= target - baseAt) return baseAt + t - pos;
        return baseAt + loop + lines[0] - pos;
    }

    double LineFor(string unit, int phraseBars = 4)
    {
        if (unit == "phrase") return Line("bar") * (phraseBars > 0 ? phraseBars : 4);
        if (unit == "end") { var st = CurrentState(); if (st != null && st.seconds > 0) return st.seconds / tempoNow; }
        return Line(unit == "beat" ? "beat" : "bar");
    }

    // Where the bar lines run from: the piece playing now (in a silence, the next one), else the loop's start
    double GridStart(double now)
    {
        if (pieceTimes.Count == 0) return startDsp;
        foreach (var p in pieceTimes) if (now >= p[0] && now < p[1]) return p[0];
        foreach (var p in pieceTimes) if (p[0] >= now) return p[0];
        return startDsp;
    }

    // A state as the costume on now dresses it: its parts, length and tempo
    List<Stem> Parts(State s, out double seconds, out double tempo)
    {
        Costume c = null;
        if (CostumeNow != null && s.costumes != null) foreach (var x in s.costumes) if (x.name == CostumeNow) c = x;
        var parts = new List<Stem>();
        var stems = c != null ? c.stems : s.stems;
        if (stems != null && stems.Length > 0) parts.AddRange(stems);
        else parts.Add(new Stem { group = null, file = c != null ? c.file : s.file });
        seconds = c != null ? c.seconds : s.seconds;
        tempo = c != null && c.tempo > 0 ? c.tempo : 1;
        return parts;
    }

    AudioSource NewSource(string file, string group)
    {
        var src = musicObject.AddComponent<AudioSource>();
        src.clip = Clip(file);
        src.playOnAwake = false;
        src.volume = volume * effectLevel * Level(group);
        return src;
    }

    // Start a state at `at`, `from` (0 to 1) of the way into its loop
    List<Voice> StartState(State s, double at, double from = 0, double oldFadesUntil = 0)
    {
        var list = new List<Voice>();
        var parts = Parts(s, out double seconds, out double tempo);
        // Crossfading: the state playing pieces carries on (fading) until then, and stops itself
        if (oldFadesUntil > 0 && pieces != null) fadeUntil[playId] = oldFadesUntil;
        else if (pieces != null) StopCoroutine(pieces);
        pieces = null;
        playId++;
        pieceTimes.Clear();
        tempoNow = tempo;
        loopSeconds = seconds;
        Current = s.name;
        stateStart = at;
        if (s.shuffleBars > 0 || (s.gap != null && s.gap.max > 0))
        {
            pieces = StartCoroutine(Pieces(s, parts, seconds, at, from, playId, list));
            startDsp = at;
            return list;
        }
        double offset = (from % 1.0) * seconds;
        foreach (var part in parts)
        {
            var src = NewSource(part.file, part.group);
            src.loop = true;
            if (src.clip != null) src.timeSamples = (int)Math.Min(src.clip.samples - 1, offset * src.clip.frequency);
            src.PlayScheduled(at);
            list.Add(new Voice { source = src, group = part.group });
        }
        startDsp = at - offset;
        return list;
    }

    // A pass through the pieces: in order, or shuffled with no piece twice running
    List<int> Order(int n, int last, bool shuffle)
    {
        var idx = new List<int>();
        for (int i = 0; i < n; i++) idx.Add(i);
        if (!shuffle) return idx;
        for (int i = n - 1; i > 0; i--) { int j = UnityEngine.Random.Range(0, i + 1); int t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
        if (n > 1 && idx[0] == last) { int t = idx[0]; idx[0] = idx[1]; idx[1] = t; }
        return idx;
    }

    // Schedule a state's pieces a little ahead of the audio clock, with its silences between passes
    IEnumerator Pieces(State s, List<Stem> parts, double seconds, double at, double from, int id, List<Voice> list)
    {
        // Bars are measures of the state's own time signature
        // (At its own bar lines, barTimes, when its tempo or time signature changes inside it)
        var lines = s.barTimes != null && s.barTimes.Length > 0 ? s.barTimes : null;
        double barLen = (s.beatsPerBar > 0 ? s.beatsPerBar : Data.beatsPerBar) * (s.beatSeconds > 0 ? s.beatSeconds : Data.beatSeconds);
        double bars = lines != null ? lines.Length : barLen > 0 ? Math.Max(1, Math.Round(s.seconds / barLen)) : Math.Max(1, Math.Round(s.bars));
        double each = s.shuffleBars > 0 && s.shuffleBars < bars ? s.shuffleBars : bars;
        Func<double, double> lineAt = n => n >= bars ? seconds : lines == null ? n / bars * seconds : n == 0 ? 0 : lines[(int)n] * seconds / s.seconds;
        var bounds = new List<double[]>();
        for (double b = 0; b < bars - 1e-6; b += each) bounds.Add(new[] { lineAt(b), lineAt(Math.Min(bars, b + each)) });
        int first = 0;
        while (first + 1 < bounds.Count && bounds[first + 1][0] <= (from % 1.0) * seconds + 1e-9) first++;
        double skip = (from % 1.0) * seconds - bounds[first][0];
        var queue = new List<int> { first };
        foreach (var i in Order(bounds.Count, first, s.shuffleBars > 0)) if (i != first) queue.Add(i);
        double next = at - skip;
        int last = first;
        // Until when this state plays: for good, or (crossfading out) to the end of the fade
        Func<double> Until = () =>
        {
            double t;
            return id == playId ? double.MaxValue : (fadeUntil.TryGetValue(id, out t) ? t : 0);
        };
        while (AudioSettings.dspTime < Until())
        {
            while (next < Math.Min(AudioSettings.dspTime + 1.5, Until()))
            {
                if (queue.Count == 0)
                {
                    if (s.gap != null && s.gap.max > 0) next += s.gap.min + UnityEngine.Random.value * Math.Max(0, s.gap.max - s.gap.min);
                    queue = Order(bounds.Count, last, s.shuffleBars > 0);
                    continue;
                }
                int k = queue[0];
                queue.RemoveAt(0);
                double a = bounds[k][0], b = bounds[k][1];
                double start = Math.Max(next + skip, AudioSettings.dspTime + 0.02);
                double dur = Math.Min(b - a - skip, Until() - start);
                if (dur > 0.01)
                {
                    foreach (var part in parts)
                    {
                        var src = NewSource(part.file, part.group);
                        if (src.clip != null) src.timeSamples = (int)Math.Min(src.clip.samples - 1, (a + skip) * src.clip.frequency);
                        src.PlayScheduled(start);
                        src.SetScheduledEndTime(start + dur);
                        list.Add(new Voice { source = src, group = part.group, end = start + dur });
                        Destroy(src, (float)(start + dur - AudioSettings.dspTime) + 0.5f);
                    }
                    pieceTimes.Add(new[] { next, next + (b - a), a });
                    if (pieceTimes.Count > 16) pieceTimes.RemoveAt(0);
                }
                skip = 0;
                last = k;
                next += b - a;
            }
            list.RemoveAll(v => v.source == null);
            yield return new WaitForSecondsRealtime(0.3f);
        }
        fadeUntil.Remove(id);
    }

    void StopVoices(List<Voice> list, double at)
    {
        foreach (var v in list)
        {
            if (v.source == null) continue;
            v.source.SetScheduledEndTime(Math.Min(at, v.end));
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
        double line = LineFor(q, r.phraseBars);
        double lead = r.leadInSeconds;
        double at = NextLine(q, r.phraseBars, GridLines(q, r.phraseBars) != null ? lead + 0.05 : 0);
        while (at - AudioSettings.dspTime < lead + 0.05) at += line;
        var old = voices;
        if (r.kind == "crossfade")
        {
            double fade = (r.beats > 0 ? r.beats : 4) * SecondsPerBeat;
            voices = StartState(s, at, 0, at + fade);
            foreach (var v in voices) v.fade = 0f;
            StartCoroutine(Crossfade(old, voices, at, fade));
            return;
        }
        double startAt = at;
        if (r.kind == "bridge" && !string.IsNullOrEmpty(r.file))
        {
            // A bridge written into the new state: it plays on the line, the state comes in after it
            PlayOnce(r.file, at);
            startAt = at + (r.bridgeSeconds > 0 ? r.bridgeSeconds : Line("bar"));
        }
        else if (!string.IsNullOrEmpty(r.file)) PlayOnce(r.file, at - lead);
        if (r.kind == "stinger" && Data.stingers != null)
            foreach (var st in Data.stingers)
                if (st.name == r.stinger) { PlayOnce(st.file, at); startAt = at + (st.bridgeSeconds > 0 ? st.bridgeSeconds : (st.bridgeBars > 0 ? st.bridgeBars : 1) * Line("bar")); }
        StopVoices(old, at);
        voices = StartState(s, startAt);
    }

    IEnumerator Crossfade(List<Voice> from, List<Voice> to, double at, double fade)
    {
        while (AudioSettings.dspTime < at + fade)
        {
            float k = (float)Math.Max(0, Math.Min(1, (AudioSettings.dspTime - at) / fade));
            foreach (var v in from) { v.fade = 1f - k; if (v.source != null) v.source.volume = volume * effectLevel * Level(v.group) * v.fade; }
            foreach (var v in to) { v.fade = k; if (v.source != null) v.source.volume = volume * effectLevel * Level(v.group) * v.fade; }
            yield return null;
        }
        foreach (var v in to) { v.fade = 1f; if (v.source != null) v.source.volume = volume * effectLevel * Level(v.group); }
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
        foreach (var v in voices) if (v.source != null) start[v] = v.source.volume;
        for (float t = 0; t < seconds; t += Time.unscaledDeltaTime)
        {
            foreach (var v in voices) if (v.source != null && start.ContainsKey(v)) v.source.volume = Mathf.Lerp(start[v], volume * effectLevel * Level(v.group) * v.fade, t / seconds);
            yield return null;
        }
        foreach (var v in voices) if (v.source != null) v.source.volume = volume * effectLevel * Level(v.group) * v.fade;
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

    /// The names of the costumes (the same music played other ways).
    public List<string> CostumeNames
    {
        get
        {
            var names = new List<string>();
            foreach (var s in Data.states) if (s.costumes != null) foreach (var c in s.costumes) if (!names.Contains(c.name)) names.Add(c.name);
            return names;
        }
    }

    /// Play the music in a costume (null: as written), crossfading over `seconds` from the same
    /// point in the loop. Every later state wears it too.
    public void SetCostume(string name, float seconds = 1f)
    {
        if (name != null && !CostumeNames.Contains(name)) throw new ArgumentException("No costume called " + name);
        if (name == CostumeNow) return;
        CostumeNow = name;
        if (Current == null) return;
        var s = Find(Current);
        double now = AudioSettings.dspTime + 0.05;
        double len = s.seconds / tempoNow;
        // A state still waiting for its line: it comes in there, in the new costume
        if (stateStart > now)
        {
            StopVoices(voices, stateStart);
            voices = StartState(s, stateStart);
            return;
        }
        double from = 0;
        if (pieceTimes.Count > 0)
        {
            double[] playing = null;
            foreach (var p in pieceTimes) if (now >= p[0] && now < p[1]) playing = p;
            // In a silence, the new costume comes in when the music would have; mid-piece, at the piece's end
            double at = playing == null ? Math.Max(GridStart(now), now) : playing[1];
            StopVoices(voices, at);
            voices = StartState(s, at);
            return;
        }
        from = (((now - startDsp) % len) + len) % len / len;
        var old = voices;
        voices = StartState(s, now, from, now + Math.Max(0.05, seconds));
        foreach (var v in voices) v.fade = 0f;
        StartCoroutine(Crossfade(old, voices, now, Math.Max(0.05, seconds)));
    }

    /// Shape the music for what's going on: "underwater", "muffled", "lowHealth", "dream" or "none",
    /// over `seconds`. Sound effects aren't touched.
    public void SetEffect(string name, float seconds = 1f)
    {
        float hz = 22000f, wet = 0f, level = 1f;
        switch (name)
        {
            case "underwater": hz = 650f; wet = 0.5f; break;
            case "muffled": hz = 1100f; wet = 0.12f; level = 0.9f; break;
            case "lowHealth": hz = 2200f; wet = 0.2f; level = 0.85f; break;
            case "dream": hz = 5000f; wet = 0.7f; level = 0.9f; break;
            case "none": break;
            default: throw new ArgumentException("No effect called " + name);
        }
        baseFilter = hz; baseReverb = wet; baseLevel = level;
        GlideMix(seconds);
    }

    /// The music through a low-pass at `hz` (22000: open), gliding over `seconds` (a parameter asking
    /// for a lower one wins while it does).
    public void SetFilter(float hz, float seconds = 0.5f)
    {
        baseFilter = Mathf.Clamp(hz, 40f, 22000f);
        GlideMix(seconds);
    }

    /// How much of the music goes to the room reverb, 0 to 1, over `seconds`.
    public void SetReverb(float amount, float seconds = 0.5f)
    {
        baseReverb = Mathf.Clamp01(amount);
        GlideMix(seconds);
    }

    float ReverbAmount => reverb.reverbPreset == AudioReverbPreset.Off ? 0f : Mathf.InverseLerp(-4000f, 0f, reverb.room);

    IEnumerator GlideEffect(float hz, float wet, float level, float seconds)
    {
        float hz0 = lowPass.cutoffFrequency, wet0 = ReverbAmount, level0 = effectLevel;
        if (wet > 0f && reverb.reverbPreset == AudioReverbPreset.Off) { reverb.reverbPreset = AudioReverbPreset.User; reverb.room = -4000f; reverb.decayTime = 2.8f; }
        for (float t = 0; t < seconds; t += Time.unscaledDeltaTime)
        {
            float k = t / Mathf.Max(0.01f, seconds);
            ApplyEffect(Mathf.Exp(Mathf.Lerp(Mathf.Log(hz0), Mathf.Log(hz), k)), Mathf.Lerp(wet0, wet, k), Mathf.Lerp(level0, level, k));
            yield return null;
        }
        ApplyEffect(hz, wet, level);
        if (wet <= 0f) reverb.reverbPreset = AudioReverbPreset.Off;
    }

    void ApplyEffect(float hz, float wet, float level)
    {
        lowPass.cutoffFrequency = Mathf.Clamp(hz, 40f, 22000f);
        if (reverb.reverbPreset != AudioReverbPreset.Off) reverb.room = Mathf.Lerp(-4000f, 0f, wet);
        effectLevel = level;
        foreach (var v in voices) if (v.source != null) v.source.volume = volume * effectLevel * Level(v.group) * v.fade;
    }

    void PlayOnce(string file, double at)
    {
        var clip = Clip(file);
        // (a file missing from the kit: nothing to play, rather than an error mid-game)
        if (clip == null) return;
        var src = musicObject.AddComponent<AudioSource>();
        src.clip = clip;
        // Stingers and bridges follow the effect's level (lowHealth and the rest) as the music does
        src.volume = volume * effectLevel;
        src.PlayScheduled(Math.Max(at, AudioSettings.dspTime));
        Destroy(src, (float)(at - AudioSettings.dspTime) + clip.length + 0.5f);
    }

    readonly Dictionary<string, int> lastSfx = new Dictionary<string, int>();
    readonly List<KeyValuePair<string, AudioSource>> sfxPlaying = new List<KeyValuePair<string, AudioSource>>();

    /// The names of the kit's sound effects.
    public IEnumerable<string> SfxNames { get { if (Data.sfx != null) foreach (var s in Data.sfx) yield return s.name; } }

    /// Play a sound effect now: one of its variations, never the same one twice in a row. A looping
    /// sound plays until StopSfx(name). `pitchSemitones` moves it (a little random pitch helps too).
    public AudioSource PlaySfx(string name, float volumeScale = 1f, float pitchSemitones = 0f)
    {
        if (Data.sfx != null)
        {
            foreach (var s in Data.sfx)
            {
                if (s.name != name || s.files == null || s.files.Length == 0) continue;
                int i = UnityEngine.Random.Range(0, s.files.Length);
                if (s.files.Length > 1 && lastSfx.TryGetValue(name, out var last) && last == i) i = (i + 1) % s.files.Length;
                lastSfx[name] = i;
                var src = gameObject.AddComponent<AudioSource>();
                src.clip = Clip(s.files[i]);
                src.loop = s.loop;
                src.playOnAwake = false;
                src.volume = sfxVolume * volumeScale;
                src.pitch = Mathf.Pow(2f, pitchSemitones / 12f);
                src.Play();
                if (!s.loop && src.clip != null) Destroy(src, src.clip.length / Mathf.Max(0.01f, src.pitch) + 0.1f);
                sfxPlaying.RemoveAll(p => p.Value == null);
                sfxPlaying.Add(new KeyValuePair<string, AudioSource>(name, src));
                return src;
            }
        }
        throw new ArgumentException("No sound effect called " + name);
    }

    /// Stop every playing sound effect called `name` (or all of them, with null).
    public void StopSfx(string name = null)
    {
        foreach (var p in sfxPlaying) if (p.Value != null && (name == null || p.Key == name)) Destroy(p.Value);
        sfxPlaying.RemoveAll(p => p.Value == null || name == null || p.Key == name);
    }

    public void Stop()
    {
        playId++;
        if (pieces != null) { StopCoroutine(pieces); pieces = null; }
        pieceTimes.Clear();
        foreach (var v in voices) if (v.source != null) Destroy(v.source);
        voices = new List<Voice>();
        Current = null;
    }
}
