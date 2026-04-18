// dashboard/src/App.tsx
import { Routes, Route } from "react-router-dom";
import MainLayout from "./components/Layout/MainLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import CallHistory from "./pages/CallHistory";
import CallDetail from "./pages/CallDetail";
import Patients from "./pages/Patients";
import PatientDetail from "./pages/PatientDetail";
import AddPatient from "./pages/AddPatient";
import EditPatient from "./pages/EditPatient";
import Doctors from "./pages/Doctors";
import DoctorDetail from "./pages/DoctorDetail";
import AddDoctor from "./pages/AddDoctor";
import EditDoctor from "./pages/EditDoctor";
import Analytics from "./pages/Analytics";
import Appointments from "./pages/Appointments";
import Schedule from "./pages/Schedule";
import Settings from "./pages/Settings";
import DemoCall from "./pages/DemoCall";
import Docs from "./pages/Docs";
import Login from "./pages/Login";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="calls" element={<CallHistory />} />
          <Route path="calls/:id" element={<CallDetail />} />
          <Route path="patients" element={<Patients />} />
          <Route path="patients/add" element={<AddPatient />} />
          <Route path="patients/:id/edit" element={<EditPatient />} />
          <Route path="patients/:id" element={<PatientDetail />} />
          <Route path="doctors" element={<Doctors />} />
          <Route path="doctors/add" element={<AddDoctor />} />
          <Route path="doctors/:id/edit" element={<EditDoctor />} />
          <Route path="doctors/:id" element={<DoctorDetail />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />} />
          <Route path="demo" element={<DemoCall />} />
          <Route path="docs" element={<Docs />} />
        </Route>
      </Route>
    </Routes>
  );
}
