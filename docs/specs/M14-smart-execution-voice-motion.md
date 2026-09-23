# M14 — Smart Execution — Voice Coach & On-Device Motion Sensing

| Status | Phase | Depends on |
|---|---|---|
| New (innovation) | Phase 4 | M00, M02, M03, M17 |

## Purpose
Hands-free training: voice cues and commands, and camera-based rep counting that runs entirely on the phone.

## Why (committee review)
Marco: hands-free cueing changes the experience. Yuki: on-device pose estimation is now practical; nothing should leave the device. Me. Hélène: camera features need explicit, per-session consent.

## Scope
- Voice guidance FR/EN (text-to-speech) with set, rep, tempo and rest cues; additional languages pluggable.
- Voice commands ('done, ten reps', 'rest', 'next') using on-device speech recognition where available.
- Camera rep counting for six movements — squat, push-up, lunge, jumping jack, glute bridge, plank hold timer — with on-device pose estimation (e.g., MediaPipe or ML Kit pose detection).
- Basic form cues (depth, tempo) labelled beta.

## Rules
- No frame, video or pose data is stored or uploaded.
- Camera mode needs an explicit per-session start; a visible indicator is always shown.
- No biometric identifiers (e.g., face geometry) are created or stored; pose keypoints exist only in memory; the L3 notice explains camera processing before first use.

## Core data entities
VoiceCueSet, RepCountEvent (count only)

## Acceptance criteria
- Rep counting accuracy and frame-rate targets met on a consented test set; privacy test proves zero network use.

## KPIs
- Share of sessions using voice
- Rep-count correction rate

## Out of scope
- Detailed biomechanical analysis or injury prediction
