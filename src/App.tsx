import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Horses from "./pages/Horses";
import HorseDetail from "./pages/HorseDetail";
import Alerts from "./pages/Alerts";
import YardView from "./pages/YardView";
import Breeding from "./pages/Breeding";
import Reports from "./pages/Reports";
import CareDiary from "./pages/CareDiary";
import Health from "./pages/Health";
import Feed from "./pages/Feed";
import Billing from "./pages/Billing";
import Portal from "./pages/Portal";
import SettingsPage from "./pages/Settings";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/horses" element={<Horses />} />
        <Route path="/horses/:id" element={<HorseDetail />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/yard" element={<YardView />} />
        <Route path="/breeding" element={<Breeding />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/diary" element={<CareDiary />} />
        <Route path="/health" element={<Health />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/portal" element={<Portal />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Layout>
  );
}
