---
name: "Field Notes Demo"
description: "A design reference derived from visible browser snapshots."
colors:
  surface: "#F6F5EF"
  on-surface: "#162822"
  primary: "#145344"
  on-primary: "#FFFFFF"
  surface-container: "#FFFCF5"
  outline: "#CCD9CD"
typography:
  headline:
    fontFamily: "Georgia, serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: "46px"
    letterSpacing: "-1.2px"
  heading-2:
    fontFamily: "Georgia, serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "42px"
  heading-3:
    fontFamily: "Georgia, serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "33px"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: "24px"
rounded:
  rounded-8: "8px"
spacing:
  spacing-8: "8px"
  spacing-12: "12px"
  spacing-16: "16px"
  spacing-18: "18px"
  spacing-24: "24px"
  spacing-160: "160px"
components:
  button:
    textColor: "#145344"
    rounded: "{rounded.rounded-8}"
    height: "44px"
  input:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.rounded-8}"
    height: "44px"
  card:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.rounded-8}"
    padding: "24px"
---

# Field Notes Demo

## Overview

Visible design traits include \#F6F5EF, Georgia, serif, a multicolumn grid, gradient treatments.

Design roles and reusable patterns are inferred from the visible sample. Measurements describe the captured states.

## Colors

- **surface** `#F6F5EF`. Page or dominant content surface (background the page text is read on (1212480 px²)).
- **on-surface** `#162822`. Text color read on the page surface (text color read on the page surface).
- **primary** `#145344`. Candidate emphasis color from buttons, links, and colored backdrops (fill of a button or link that differs from its own text).
- **on-primary** `#FFFFFF`. Foreground sampled from actions using the candidate primary fill (text sitting on the primary fill).
- **surface-container** `#FFFCF5`. Secondary region or component surface (largest secondary background (251896 px²)).
- **outline** `#CCD9CD`. Frequently observed visible border color (most common visible border color).
- Observed gradient `radial-gradient(at 78% 20%, rgb(255, 252, 245), rgba(0, 0, 0, 0) 52%), linear-gradient(135deg, rgb(206, 224, 198), rgb(246, 245, 239))`.

## Typography

- **headline** uses `Georgia, serif` at 40px, weight 700, 46px line height.
- **heading-2** uses `Georgia, serif` at 28px, weight 700, 42px line height.
- **heading-3** uses `Georgia, serif` at 22px, weight 700, 33px line height.
- **body** uses `system-ui, sans-serif` at 16px, weight 400, 24px line height.
- **label** uses `system-ui, sans-serif` at 16px, weight 650, 24px line height.

## Layout


### Viewport 1440 × 900 CSS px

System color preference is light. Reduced motion is not requested.

- **main** uses block, 1120px wide, max width 1120px.
- **section** uses grid, 1120px wide, 2 columns, 24px gap.
- **container** uses grid, 1120px wide, 3 columns, 24px gap.
- **container** uses grid, 363px wide, max width 362.812px, 1 column, 8px gap.
- **navigation** uses flex, 1120px wide, max width 1120px, row direction, 16px gap.
- **section** uses block, 1120px wide.
- **header** uses block, 1440px wide.
- **button** uses inline-flex, 248px wide, row direction.

Capture kept 34 visible samples from 38 visited elements in the main document.

### Viewport 390 × 900 CSS px

System color preference is light. Reduced motion is not requested.

- **main** uses block, 358px wide, max width 1120px.
- **section** uses grid, 358px wide, 1 column, 24px gap.
- **container** uses grid, 358px wide, 1 column, 24px gap.
- **navigation** uses flex, 358px wide, max width 1120px, row direction, 16px gap.
- **section** uses block, 358px wide.
- **header** uses block, 390px wide.
- **button** uses inline-flex, 156px wide, row direction.

Capture kept 24 visible samples from 38 visited elements in the main document.

Frequently observed spacing sizes are 8px, 12px, 16px, 18px, 24px, 160px.

## Shapes

Common observed corner radii are 8px.

## Components

- Reuse the captured `button` token group for the matching component role.
- Reuse the captured `input` token group for the matching component role.
- Reuse the captured `card` token group for the matching component role.

### Motion & Micro-interaction

Motion evidence at 1440 × 900 CSS px.

| Target | Evidence | Source | Properties | Duration | Delay | Easing | Iterations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| button | observed | css-transition | `transform` | 180ms | 0ms | `ease-out` | 1 |
| button | observed | css-transition | `transform` | 51.68314611992551ms | 0ms | `ease-out` | 1 |
| container | observed | css-animation | `opacity`, `transform` | 420ms | 0ms | `ease-in-out` | 1 |
| button | declared | css-transition | `transform` | 180ms | 0ms | `ease-out` | 1 |

Motion evidence at 390 × 900 CSS px.

| Target | Evidence | Source | Properties | Duration | Delay | Easing | Iterations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| button | observed | css-transition | `transform` | 51.68314611992551ms | 0ms | `ease-out` | 1 |
| container | observed | css-animation | `opacity`, `transform` | 420ms | 0ms | `ease-in-out` | 1 |
| container | observed | web-animation | `opacity`, `transform` | 480ms | 0ms | `cubic-bezier(0.2, 0.7, 0.2, 1)` | 1 |
| button | declared | css-transition | `transform` | 180ms | 0ms | `ease-out` | 1 |
| container | declared | css-animation | Unknown | 420ms | 0ms | `ease-in-out` | 1 |

Declared motion comes from computed CSS. Observed motion was active during sampling. Interaction triggers require separate verification.

## Do's and Don'ts

- Treat measured layouts as examples at their recorded viewport sizes. Verify any responsive breakpoint with additional evidence.
- Confirm inferred color roles before applying them across additional components.
- Recheck interaction behavior with reduced motion enabled.
