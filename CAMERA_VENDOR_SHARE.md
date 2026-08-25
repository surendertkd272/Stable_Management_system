# To share with the camera vendor (Sparsh) — SC-IT6420-HB V2

## A. Recommended configuration (please supply/build to this)
- **Model:** SC-IT6420-HB V2, **640×512 thermal** variant.
- **Lenses:** **25 mm thermal** (primary — for nose/eye detail) and **4 mm visible** (full-stall view). Please also quote a **13 mm thermal** for comparison.
- **Focus:** fixed focus **factory-set to a 3.5 m working distance**.
- **IR:** **940 nm** illuminator (no visible glow), **independently disable-able while the thermal stream and ROI temperature stay fully functional in darkness**.
- **Streaming:** **H.265** on all three streams (IR / visible / fusion) at 25 fps; target **≤4 Mbps per 1080p stream**.
- **Visible sensor:** **global shutter**.
- **Targeting:** **factory visible↔thermal calibration**, exposed via the SDK (so a coordinate in the visible image returns the temperature at the matching thermal location — **no field calibration on our side**).

## B. What we need from you BEFORE we begin development

### Deliverables
1. **2 evaluation units** (640×512): one with **25 mm** thermal lens, one with **13 mm**, both visible **4 mm**, **focus factory-set for 3.5 m**.
2. **SDK package:** headers, libraries, and **working sample code** for **set-ROI, set-emissivity, poll-temperature, and RTSP**, plus a **development licence**.
3. **Factory visible↔thermal calibration** delivered on the units and exposed in the SDK. Please state the **achievable mapping accuracy (pixels/mm) at 3–4 m** and whether re-calibration is needed after re-mounting.

### Technical confirmations
4. The SDK can **create, move, and read an ROI by coordinates at runtime in the thermal frame**, and support **≥2 simultaneous ROIs per camera**.
5. **Maximum ROI reposition rate** (updates/second) and **maximum simultaneous temperature-poll rate**, and whether the limit is **per device or per host**.
6. **Per-stream bitrate (Mbps)** for IR / visible / fusion at 25 fps, and the **aggregate** with all three active plus temperature polling.
7. **Visible sensor model/part number** confirming **global shutter**, and **lens distortion (%)** for the 4/6 mm lenses.
8. **Thermal pixels on a 5 cm target (nose/eye) at 3 m and 4 m** for the 25 mm and 13 mm lenses (please confirm/lock your earlier figures: 25 mm = 24/18 px, 13 mm = 12/9 px).

### Written confirmations (please put on the order)
9. **940 nm IR illuminator** · **H.265 on all three streams at 25 fps** · **IR disable-able while thermal + ROI temperature remain functional** · **fixed focus factory-set to our specified distance**.

---

*Note: the horse-detection and ROI-tracking logic is handled on our side; we require only the factory visible↔thermal calibration/mapping from you (item 3), not a full overlay application.*
