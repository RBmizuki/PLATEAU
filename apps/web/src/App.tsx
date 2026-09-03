import { NavLink, Route, Routes } from 'react-router-dom';
import { ResidentPage } from './pages/ResidentPage';
import { ContractorPage } from './pages/ContractorPage';

export function App() {
  return (
    <>
      <header className="app-header">
        <h1>足場の割り勘</h1>
        <span className="tagline">屋根の太陽光を、ご近所の束で安く降ろす</span>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>住民のかた</NavLink>
          <NavLink to="/contractor" className={({ isActive }) => (isActive ? 'active' : '')}>事業者のかた</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<ResidentPage />} />
        <Route path="/contractor" element={<ContractorPage />} />
      </Routes>
    </>
  );
}
