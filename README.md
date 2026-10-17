# Tailbone Treatment Clinic website

A redesigned, dependency-free static site for [tailbonetreatment.com](https://tailbonetreatment.com/), the coccydynia clinic run by Dr Rajveer Singh in Bengaluru and New Delhi.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

It is plain HTML, CSS and JS, so it can be deployed as-is to GitHub Pages, Netlify, Vercel or any web host.

## Features

- Live "Open now / Closed" status based on clinic time (IST), with today's hours highlighted
- Interactive symptom self-check with a severity meter
- Animated spine illustration that highlights the coccyx
- Appointment form that validates input and opens WhatsApp with a pre-filled request (nothing is stored)
- Floating WhatsApp chat widget plus a sticky Call / WhatsApp / Book bar on mobile
- Tabbed clinic locations (Bengaluru, New Delhi, Online) with lazy-loaded Google Maps
- Testimonial carousel with autoplay, swipe and dots
- Dark mode (follows the system setting and remembers your choice), scroll progress bar and scroll-spy navigation
- Accessible: skip link, keyboard-friendly tabs and FAQ, reduced-motion support
- SEO: meta and Open Graph tags, plus `MedicalClinic` structured data

## Structure

```
index.html          Main one-page site
privacy.html        Privacy statement
assets/css/styles.css
assets/js/main.js
assets/img/logo.svg
```

## To update

- Clinic hours: `HOURS` in `assets/js/main.js` and the hours lists in `index.html`
- Phone / WhatsApp: search for `919886688323`
- Add a real doctor photo by replacing `.doctor__initials` in the `#doctor` section with an `<img>`
