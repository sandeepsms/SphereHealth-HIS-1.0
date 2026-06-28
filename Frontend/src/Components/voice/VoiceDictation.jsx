// Components/voice/VoiceDictation.jsx
// R7hr-267 (USER, 2026-06-22): global voice-to-text dictation.
//
// A single floating mic widget, mounted ONCE in the authenticated app shell.
// It dictates into WHATEVER text field currently has focus (or the last one
// that did), so every <input>/<textarea>/contenteditable across the app gains
// voice entry WITHOUT touching any existing form component — fully additive,
// R25 launch-ready safe.
//
// Engine: browser Web Speech API (window.SpeechRecognition /
// webkitSpeechRecognition) — free, no backend, no API key. Works in Chrome /
// Edge. Audio is processed by the browser vendor's speech service. (For PHI at
// scale you'd swap in a self-hosted STT later; this is the zero-infra start.)
//
// Language: en-IN by default, one-tap toggle to hi-IN (Hindi). Restarts the
// recogniser on switch so the new language takes effect immediately.
import { useEffect, useRef, useState, useCallback } from "react";
import { applyMedicalCorrections } from "./medicalDictionary";
import "./voiceDictation.css";

const SR =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const LANGS = {
  "en-IN": { short: "EN", label: "English" },
  "hi-IN": { short: "हि", label: "हिन्दी (Hindi)" },
};

/* Which elements may receive dictation. */
function isEditableEl(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "url", "tel", ""].includes(t);
  }
  if (el.isContentEditable) return true;
  return false;
}

/* Turn a SMALL, medical-safe set of spoken commands into symbols. We
   deliberately keep this conservative — e.g. we do NOT map "period" (would
   clobber "menstrual period") — only phrases unlikely to be literal text. */
function applyDictationCommands(raw, lang) {
  let s = ` ${raw} `;
  const common = [
    [/\s+(new paragraph)\s+/gi, "\n\n"],
    [/\s+(new line|next line)\s+/gi, "\n"],
    [/\s+(full stop)\s+/gi, ". "],
  ];
  const hindi = [
    [/\s*(नया पैराग्राफ)\s*/g, "\n\n"],
    [/\s*(नई लाइन|नयी लाइन|अगली लाइन)\s*/g, "\n"],
    [/\s*(पूर्ण विराम)\s*/g, "। "],
  ];
  const rules = lang.startsWith("hi") ? hindi.concat(common) : common;
  rules.forEach(([re, rep]) => {
    s = s.replace(re, rep);
  });
  // collapse extra spaces (but keep newlines), trim only spaces/tabs at ends
  return s.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
}

/* Insert text into a React-controlled field at the caret, firing a native
   'input' event so the owning component's onChange/state actually updates. */
function insertIntoField(el, text) {
  if (!el || !document.contains(el)) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") {
    const proto =
      tag === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const cur = el.value ?? "";
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const before = cur.slice(0, start);
    const after = cur.slice(end);
    let ins = text;
    // join words with a space; never add a space before a newline/punctuation
    if (before && !/\s$/.test(before) && !/^[\s.,?!:;)\]।]/.test(ins)) ins = " " + ins;
    if (after && !/^\s/.test(after) && !/[\s\n]$/.test(ins)) ins = ins + " ";
    const next = before + ins + after;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = (before + ins).length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* some inputs disallow setSelectionRange */
    }
    return true;
  }
  if (el.isContentEditable) {
    el.focus();
    try {
      document.execCommand("insertText", false, text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export default function VoiceDictation() {
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState("en-IN");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [hasTarget, setHasTarget] = useState(false);

  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const langRef = useRef("en-IN");
  const lastEditableRef = useRef(null);

  /* Track the last focused editable element so the floating button — which is
     not itself a field — knows where to insert. */
  useEffect(() => {
    const onFocusIn = (e) => {
      if (isEditableEl(e.target)) {
        lastEditableRef.current = e.target;
        setHasTarget(true);
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    setInterim("");
    const rec = recRef.current;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* not started */
      }
    }
  }, []);

  const startListening = useCallback(() => {
    if (!SR) {
      setError("Voice input needs Chrome or Edge.");
      return;
    }
    setError("");
    let rec;
    try {
      rec = new SR();
    } catch {
      setError("Could not start the microphone.");
      return;
    }
    rec.lang = langRef.current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (finalChunk.trim()) {
        // 1) spoken punctuation commands, then 2) medical-vocabulary correction
        // (drug-name spelling/casing + abbreviation fixes — R7hr-271).
        let processed = applyDictationCommands(finalChunk, langRef.current);
        processed = applyMedicalCorrections(processed);
        const target = lastEditableRef.current;
        if (target) insertIntoField(target, processed);
      }
      setInterim(interimChunk);
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone blocked — allow mic access for this site.");
        stopListening();
      } else if (e.error === "network") {
        setError("Speech service unreachable (network).");
      }
      // "no-speech" / "aborted" are benign; onend restarts if still listening.
    };

    rec.onend = () => {
      // continuous mode still stops on long silence — restart while live.
      if (listeningRef.current) {
        try {
          rec.start();
        } catch {
          /* race: already starting */
        }
      } else {
        setInterim("");
      }
    };

    recRef.current = rec;
    listeningRef.current = true;
    setListening(true);
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, [stopListening]);

  const toggle = useCallback(() => {
    if (listeningRef.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);

  const toggleLang = useCallback(() => {
    const next = langRef.current === "en-IN" ? "hi-IN" : "en-IN";
    langRef.current = next;
    setLang(next);
    if (listeningRef.current) {
      // the running recogniser keeps its old lang — restart fresh
      listeningRef.current = false;
      const rec = recRef.current;
      if (rec) {
        rec.onend = null;
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      setTimeout(() => startListening(), 180);
    }
  }, [startListening]);

  // stop cleanly on unmount
  useEffect(
    () => () => {
      listeningRef.current = false;
      const r = recRef.current;
      if (r) {
        r.onend = null;
        try {
          r.stop();
        } catch {
          /* noop */
        }
      }
    },
    []
  );

  // Unsupported browser → render nothing (keeps every page clean).
  if (!SR) return null;

  // keep the active text field focused when the buttons are pressed
  const keepFocus = (e) => e.preventDefault();

  return (
    <div
      className={`vdict ${listening ? "vdict--on" : ""}`}
      onMouseDown={keepFocus}
    >
      {(interim || error) && (
        <div className={`vdict-bubble ${error ? "vdict-bubble--err" : ""}`}>
          {error || interim}
        </div>
      )}
      <div className="vdict-row">
        <button
          type="button"
          className="vdict-lang"
          title={`Dictation language: ${LANGS[lang].label} — tap to switch`}
          onMouseDown={keepFocus}
          onClick={toggleLang}
        >
          {LANGS[lang].short}
        </button>
        <button
          type="button"
          className={`vdict-mic ${listening ? "is-live" : ""}`}
          title={
            listening
              ? "Listening… tap to stop"
              : hasTarget
              ? "Dictate into the current field"
              : "Click a text field, then tap to dictate"
          }
          aria-pressed={listening}
          onMouseDown={keepFocus}
          onClick={toggle}
        >
          {listening ? "■" : "🎤"}
        </button>
      </div>
    </div>
  );
}
