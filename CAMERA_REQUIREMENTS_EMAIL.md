# Camera requirements — vendor email (paste-ready)

**To:** Sparsh CCTV
**Subject:** Required specifications to confirm — SC-IT6420-HB V2 (640×512) for equine monitoring

Hello,

Thank you for the earlier clarifications. Before we proceed and begin our software integration, please confirm that the camera can meet each requirement below **at the stated value**, or tell us the actual figure/limitation. These are the only open items on our side.

| # | Requirement | Value we need |
|---|-------------|---------------|
| 1 | Resolve a 5 cm target (horse nose/eye) on the thermal image at stall distance | **≥10 thermal pixels across a 5 cm target at 4 m** (min 3×3 px). Please state the figure at 3 m and 4 m for each thermal lens. |
| 2 | Stay in focus at mounting distance | **In focus across 2.5–4 m; minimum focus distance ≤1.5 m** — for the 13 mm thermal and 4 mm/6 mm visible lenses. |
| 3 | Measure a chosen spot's temperature, two spots per horse | **≥2 independent ROIs read simultaneously** — nostril (Avg) + eye (Max). **Per-pixel radiometric frame access preferred.** |
| 4 | Aim the thermal measuring point from a location in the visible video | **A documented API/transform from a visible-image pixel (x,y) → thermal ROI PosX/PosY**, accurate to within a few pixels at 3–4 m. |
| 5 | Move the measuring point and poll fast enough | **ROI reposition ≥25 updates/sec; per-ROI temperature read ≥10 Hz; sustained polling on ≥4 cameras from one host.** Please state any per-device vs per-host limit. |
| 6 | Allow time-alignment of video and temperature | **PTP (IEEE-1588) support, or embedded per-frame RTSP timestamps (RTCP)**, giving video↔temperature alignment within ≤50 ms. |
| 7 | Enable us to begin development now | **SDK delivered (C/C++ headers, libraries, and a working sample for set-ROI, set-emissivity, poll-temperature, RTSP) + 2 evaluation 640×512 units, with a development licence.** |
| 8 | Fit our network, storage and decode pipeline | **State the per-stream bitrate (Mbps); confirm H.265 on all three streams at 25 fps; target ≤4 Mbps per 1080p stream.** |
| 9 | Provide clean images for motion/gait analysis | **Global-shutter visible sensor; lens geometric distortion ≤3% or vendor-supplied correction.** |
| 10 | Operate at night without disturbing the animals | **940 nm IR illuminator; IR independently schedulable/disable-able while the thermal stream and ROI temperature remain fully functional in total darkness.** |

For each row, please reply with **"Yes — meets [value]"** or the **actual specification**. If any item needs an alternative model in the same SDK/RTSP/ONVIF family, please advise.

Thank you,
BSV EquiCare team
