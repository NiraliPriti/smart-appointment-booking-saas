import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './pages/Layout';
import AuthPage from './pages/Auth';
import Overview from './pages/Overview';
import Calendar from './pages/Calendar';
import Bookings from './pages/Bookings';
import Clients from './pages/Clients';
import Services from './pages/Services';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import PublicBooking from './pages/PublicBooking';

const Landing = () => (
  <div className="hero stack">
    <h1>Online booking for barbers, salons, clinics and consultants</h1>
    <p className="muted">Publish a booking page in minutes. Clients pick a time that is genuinely free; you manage everything from one calendar.</p>
    <div className="row"><Link className="btn" to="/signup">Create your business</Link><Link className="btn ghost" to="/login">Sign in</Link></div>
  </div>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/booking/:slug" element={<PublicBooking />} />
      <Route path="/dashboard" element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="clients" element={<Clients />} />
        <Route path="services" element={<Services />} />
        <Route path="settings" element={<Settings />} />
        <Route path="billing" element={<Billing />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
