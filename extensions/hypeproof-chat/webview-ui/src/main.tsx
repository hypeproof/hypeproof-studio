// The tokens have to come first (SX-49). The order in which the imports below pull CSS in
// is exactly the stylesheet order: tokens.css → localReview.css (LocalReview) →
// start.css (StartPage) → styles.css (last, explicit import).
import "./tokens.css";
import { AutomationSurface } from "./AutomationSurface";
import "./focusGeometry.css";
import { LocalReview } from "./LocalReview";
import { SkillStore } from "./SkillStore";
import { createRoot } from "react-dom/client";
import { StartPage } from "./StartPage";
import { App } from "./App";
import { installImeHostBarrier } from "./imeGuard";
import "./styles.css";
import "./chatDetails.css";
import "./tooltips.css";
import { installTooltips } from "./tooltips";
import "./koreanProse.css";

installImeHostBarrier(document);
const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
const surface = document.documentElement.dataset.surface;
createRoot(container).render(surface === "automation" ? <AutomationSurface /> : surface === "local-review" ? <LocalReview /> : surface === "skill-store" ? <SkillStore /> : surface === "start" ? <StartPage /> : <App />);

installTooltips(document);
