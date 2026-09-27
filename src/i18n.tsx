"use client";

// Interface language: English or Hindi (for grooms on the overnight shift).
// Covers what they use — navigation, page titles, status words, alert titles,
// the horse page and the dashboard. Longer explanations written by the
// server (an alert's detail text) stay in English. The key is the English
// text itself, so an untranslated string simply shows in English.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "hi";
const LANG_KEY = "bsv-lang";

const HI: Record<string, string> = {
  // navigation
  Monitoring: "निगरानी", Records: "रिकॉर्ड", Operations: "संचालन", Business: "व्यवसाय", System: "सिस्टम",
  Dashboard: "डैशबोर्ड", Horses: "घोड़े", Alerts: "अलर्ट", "Yard View": "यार्ड दृश्य", Breeding: "प्रजनन",
  Reports: "रिपोर्ट", "Care Diary": "देखभाल डायरी", "Behaviour guide": "व्यवहार गाइड",
  "Health Scheduling": "स्वास्थ्य कार्यक्रम", "Feed & Nutrition": "चारा और पोषण", Billing: "बिलिंग",
  "Owner Portal": "मालिक पोर्टल", Hardware: "हार्डवेयर", "Footage & labels": "फुटेज और लेबल", Settings: "सेटिंग्स",
  // top bar
  "Add horse": "घोड़ा जोड़ें", "Search horses": "घोड़े खोजें", Notifications: "सूचनाएँ", "Sign out": "साइन आउट",
  Light: "हल्का", Dark: "गहरा", Back: "वापस", Close: "बंद करें", Save: "सहेजें", Cancel: "रद्द करें",
  // status
  Calm: "शांत", Watch: "नज़र रखें", Urgent: "तुरंत", calm: "शांत", watch: "नज़र रखें", urgent: "तुरंत",
  prototype: "प्रोटोटाइप", "not measured": "मापा नहीं गया", "Not measured": "मापा नहीं गया",
  // alerts page
  "All clear": "सब ठीक है", "No behavioural alerts": "कोई व्यवहार अलर्ट नहीं", Acknowledge: "देख लिया",
  Acknowledged: "देख लिया गया", "Needs attention": "ध्यान दें", Open: "खुले", All: "सभी",
  "Delivery: see Settings": "भेजना: सेटिंग्स देखें",
  // alert titles (fixed strings from the server)
  "Elevated body temperature": "शरीर का तापमान बढ़ा हुआ", "Body temperature rising": "शरीर का तापमान बढ़ रहा है",
  "Low body temperature": "शरीर का तापमान कम", "Eye temperature below usual": "आँख का तापमान सामान्य से कम",
  "High respiratory rate": "साँस की दर ज़्यादा", "Respiratory pattern": "साँस का पैटर्न",
  "Abnormal activity — colic pattern": "असामान्य गतिविधि — पेट दर्द (कॉलिक) का पैटर्न",
  "Low lying-down time": "लेटने का समय कम", "Possible lameness": "लंगड़ापन संभव", "Low water intake": "पानी कम पिया",
  "Stable vice": "अस्तबल की आदत", "Activity unusual for this horse": "इस घोड़े के लिए असामान्य गतिविधि",
  "No manure seen": "लीद नहीं दिखी", "No urination seen": "पेशाब नहीं दिखा", "Less manure than usual": "सामान्य से कम लीद",
  "Lying down and getting up repeatedly": "बार-बार लेटना और उठना", "Possibly cast — check the horse now": "शायद फँसा हुआ — अभी घोड़े को देखें",
  "Possible rolling": "लोटना संभव", "Lying flat on the side a long time": "देर तक करवट लेटा हुआ",
  "Little lying down at night": "रात में बहुत कम लेटा", "Camera not aimed": "कैमरा सही दिशा में नहीं",
  "Monitoring offline": "निगरानी बंद", "Monitoring gap": "निगरानी में अंतराल", "No monitoring data": "निगरानी डेटा नहीं",
  "Device error": "उपकरण में खराबी", "Device not reporting": "उपकरण रिपोर्ट नहीं कर रहा", "Edge box offline": "एज बॉक्स बंद",
  // horse page
  "Live vitals": "लाइव जाँच", "Body temperature": "शरीर का तापमान", "Respiratory rate": "साँस की दर",
  Activity: "गतिविधि", "Activity · prototype": "गतिविधि · प्रोटोटाइप", "Daily rest": "रोज़ का आराम",
  "Behaviour from the camera": "कैमरे से व्यवहार", "What this may mean": "इसका क्या मतलब हो सकता है",
  "Respiration pattern": "साँस का पैटर्न", "Resting (still)": "आराम (स्थिर)", "Lying down": "लेटना",
  Urination: "पेशाब", Excretion: "लीद", Weaving: "झूलना (वीविंग)", "Box walking": "बॉक्स में चक्कर",
  "Head tossing": "सिर झटकना", "Care diary": "देखभाल डायरी", "Recent alerts": "हाल के अलर्ट",
  "Camera reference": "कैमरा दृश्य", "Generate vet report": "पशु-चिकित्सक रिपोर्ट बनाएं", "Add diary note": "डायरी नोट जोड़ें",
  "read just now": "अभी पढ़ा", "last read": "आख़िरी बार पढ़ा", read: "पढ़ा", ago: "पहले", min: "मिनट", h: "घंटे", d: "दिन",
  camera: "कैमरा", "Body temperature · uncalibrated": "शरीर का तापमान · कैलिब्रेट नहीं",
  "Respiratory rate · uncalibrated": "साँस की दर · कैलिब्रेट नहीं", "Daily rest · camera prototype": "रोज़ का आराम · कैमरा प्रोटोटाइप",
  "Water intake": "पानी", "Time outside box": "बॉक्स के बाहर समय",
  // dashboard
  "Stress level": "तनाव स्तर", "Yard map": "यार्ड नक्शा", "Alerts this week": "इस हफ़्ते के अलर्ट",
  "Foaling watch": "ब्याने पर नज़र", "Risk radar": "जोखिम रडार", "What we monitor here": "हम यहाँ क्या देखते हैं",
  // settings
  Appearance: "दिखावट", Theme: "थीम", "Interface language": "भाषा", "Alert delivery": "अलर्ट भेजना",
  "Send these alerts": "ये अलर्ट भेजें", "Sensitivity & calibration": "संवेदनशीलता और कैलिब्रेशन",
};

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string }>({
  lang: "en", setLang: () => {}, t: (s) => s,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      if (localStorage.getItem(LANG_KEY) === "hi") setLangState("hi");
    } catch { /* private window: English */ }
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* not remembered, still switched */ }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback((s: string) => (lang === "hi" ? HI[s] ?? s : s), [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
