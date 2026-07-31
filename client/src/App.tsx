import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import TrendsPage from './pages/TrendsPage';
import FingerprintsPage from './pages/FingerprintsPage';
import SyncPage from './pages/SyncPage';
import { DateRangeProvider } from './contexts/DateRangeContext';

function App() {
  return (
    <BrowserRouter>
      <DateRangeProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="trends" element={<TrendsPage />} />
            <Route path="fingerprints" element={<FingerprintsPage />} />
            <Route path="sync" element={<SyncPage />} />
          </Route>
        </Routes>
      </DateRangeProvider>
    </BrowserRouter>
  );
}

export default App;
