// dashboard/src/App.tsx
import { Routes, Route } from "react-router-dom";
import MainLayout from "./components/Layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import CallHistory from "./pages/CallHistory";
import CallDetail from "./pages/CallDetail";
import Patients from "./pages/Patients";
import PatientDetail from "./pages/PatientDetail";
import AddPatient from "./pages/AddPatient";
import Doctors from "./pages/Doctors";
import AddDoctor from "./pages/AddDoctor";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import DemoCall from "./pages/DemoCall";
import Docs from "./pages/Docs";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="calls" element={<CallHistory />} />
        <Route path="calls/:id" element={<CallDetail />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="patients/add" element={<AddPatient />} />
        <Route path="doctors" element={<Doctors />} />
        <Route path="doctors/add" element={<AddDoctor />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="demo" element={<DemoCall />} />
        <Route path="docs" element={<Docs />} />
      </Route>
    </Routes>
  );
}
