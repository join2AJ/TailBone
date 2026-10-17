# Explainer videos

Short animated explainers (16–20 seconds, no sound) in two shapes:

| Video | Use it for |
|---|---|
| `sitting-*.mp4` | Why sitting hurts, and the simple posture change that helps. Good for the desk-job / IT audience. |
| `cushion-*.mp4` | Why a cut-out cushion helps (and how the TBT cushion works). |
| `pregnancy-*.mp4` | Tailbone pain after childbirth. For new mothers and women's-health audiences. |
| `red-flags-*.mp4` | When to use self-care, see a specialist, or go urgently. |
| `visit-steps-*.mp4` | What happens at a visit, in four steps. Reassures nervous first-time patients. |

- `-16x9.mp4`: YouTube, Google Ads (Performance Max / video), the website
- `-1x1.mp4`: Instagram and Facebook feed, WhatsApp Status

For YouTube ads, upload them to the clinic's YouTube channel (Public or Unlisted), then paste the links into Google Ads → Videos. Add background music in YouTube Studio's free Audio Library if you like.

Re-create them after changing an animation in `content/animations/`:
```
npm start   # or any static server on public/, then:
BASE=http://localhost:3000 node resources/videos/render-videos.mjs
```
(needs Playwright and ffmpeg)
