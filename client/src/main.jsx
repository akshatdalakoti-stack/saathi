import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { ToastProvider } from './ui.jsx';
import Landing from './pages/Landing.jsx';
import { ElderLogin, MemberLogin, Join, Setup, Waiting } from './pages/Auth.jsx';
import Elder from './pages/Elder.jsx';
import Care from './pages/Care.jsx';
import VisitSheet from './pages/VisitSheet.jsx';

// Offline support: only in the built app, not while developing.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/elder/login" element={<ElderLogin />} />
          <Route path="/login" element={<MemberLogin />} />
          <Route path="/join" element={<Join />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/waiting" element={<Waiting />} />
          <Route path="/elder" element={<Elder />} />
          <Route path="/care/visit/:id" element={<VisitSheet />} />
          <Route path="/care/*" element={<Care />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
