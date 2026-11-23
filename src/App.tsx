import React, { useState, Suspense, lazy } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { SettingsView } from './components/SettingsView';
import { RfinARequestView } from './components/RfinARequestView';
import { RfinBInputView } from './components/RfinBInputView';
import { NotificationBanner } from './components/NotificationBanner';
import { AuthGate } from './components/AuthGate';
import { ItemBarang, JenisMutasiBarang, JenisMutasiKas } from './types';

// Code-splitting Lazy Loading untuk view-view besar demi optimasi INP (Interaction to Next Paint)
const StockMutationView = lazy(() =>
  import('./components/StockMutationView').then((m) => ({ default: m.StockMutationView }))
);
const CashflowView = lazy(() =>
  import('./components/CashflowView').then((m) => ({ default: m.CashflowView }))
);
const ReportsView = lazy(() =>
  import('./components/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const PersonalDashboardView = lazy(() =>
  import('./components/PersonalDashboardView').then((m) => ({ default: m.PersonalDashboardView }))
);
const PlatformConsole = lazy(() =>
  import('./components/PlatformConsole').then((m) => ({ default: m.PlatformConsole }))
);
const CompanyConsole = lazy(() =>
  import('./components/CompanyConsole').then((m) => ({ default: m.CompanyConsole }))
);
const VerificationPortal = lazy(() =>
  import('./components/VerificationPortal').then((m) => ({ default: m.VerificationPortal }))
);
const LandingPageView = lazy(() =>
  import('./components/LandingPageView').then((m) => ({ default: m.LandingPageView }))
);

const ViewFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[360px] p-8 text-center animate-in fade-in duration-100">
    <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2.5"></div>
    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Memuat tampilan...</span>
  </div>
);

const MainApp: React.FC = () => {
  const { currentView, appMode, activeRole } = useApp();
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [preselectedStockItem, setPreselectedStockItem] = useState<ItemBarang | null>(null);
  const [preselectedStockType, setPreselectedStockType] = useState<JenisMutasiBarang>('MASUK');
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [preselectedCashType, setPreselectedCashType] = useState<JenisMutasiKas>('KELUAR');

  const handleOpenStockModal = (type: JenisMutasiBarang = 'MASUK', item: ItemBarang | null = null) => {
    setPreselectedStockType(type);
    setPreselectedStockItem(item);
    setIsStockModalOpen(true);
  };

  const handleOpenCashModal = (type: JenisMutasiKas = 'KELUAR') => {
    setPreselectedCashType(type);
    setIsCashModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      <Header />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />
        <main className="flex-1 p-3 sm:p-5 lg:p-8 max-w-7xl w-full mx-auto overflow-y-auto touch-scroll">
          {/* Kotak Notifikasi / Undangan Resmi In-House */}
          <NotificationBanner />

          <Suspense fallback={<ViewFallback />}>
            {/* Landing Page & Monetisasi Modular (Dapat Diakses dari Mana Saja) */}
            {currentView === 'landing' && <LandingPageView />}

            {/* Mode PSA */}
            {currentView !== 'landing' && appMode === 'PSA' && <PlatformConsole />}

            {/* Mode CSA */}
            {currentView !== 'landing' && appMode === 'CSA' && <CompanyConsole />}

            {/* Mode Personal */}
            {currentView !== 'landing' && appMode === 'PERSONAL' && (
              <>
                {currentView === 'dashboard' && <PersonalDashboardView />}
                {currentView === 'rfin-a-request' && <RfinARequestView />}
                {currentView === 'rfin-b-input' && <RfinBInputView />}
                {currentView === 'reports' && <ReportsView />}
                {currentView === 'verification' && <VerificationPortal />}
                {currentView === 'settings' && <SettingsView />}
              </>
            )}

            {/* Mode Impersonate (Operasional 2 Modul Inti: Mutasi Barang & Mutasi Dana) */}
            {currentView !== 'landing' && appMode === 'IMPERSONATE' && (
              <>
                {currentView === 'dashboard' && (
                  <DashboardView
                    onOpenStockModal={handleOpenStockModal}
                    onOpenCashModal={handleOpenCashModal}
                  />
                )}
                {currentView === 'rfin-b-input' && <RfinBInputView />}
                {currentView === 'inventory' && (
                  <InventoryView
                    onQuickMutate={(item, type) => handleOpenStockModal(type, item)}
                    canMutate={true}
                  />
                )}
                {currentView === 'stock-mutations' && (
                  <StockMutationView
                    isModalOpen={isStockModalOpen}
                    setIsModalOpen={setIsStockModalOpen}
                    preselectedItem={preselectedStockItem}
                    preselectedType={preselectedStockType}
                  />
                )}
                {currentView === 'cashflow' && activeRole !== 'Viewer/Pengamat' && (
                  <CashflowView
                    isModalOpen={isCashModalOpen}
                    setIsModalOpen={setIsCashModalOpen}
                    defaultType={preselectedCashType}
                  />
                )}
                {currentView === 'cashflow' && activeRole === 'Viewer/Pengamat' && (
                  <StockMutationView
                    isModalOpen={isStockModalOpen}
                    setIsModalOpen={setIsStockModalOpen}
                    preselectedItem={preselectedStockItem}
                    preselectedType={preselectedStockType}
                  />
                )}
                {currentView === 'reports' && <ReportsView />}
                {currentView === 'verification' && <VerificationPortal />}
                {/* Di Mode Impersonate tidak ada Settings; jika diarahkan ke settings, tampilkan dashboard */}
                {currentView === 'settings' && (
                  <DashboardView
                    onOpenStockModal={handleOpenStockModal}
                    onOpenCashModal={handleOpenCashModal}
                  />
                )}
              </>
            )}
          </Suspense>
        </main>
      </div>

      {/* Modal Dialog Pop-up Transaksi (HANYA dimount saat modal benar-benar terbuka demi optimalisasi INP & memori) */}
      <Suspense fallback={null}>
        {isStockModalOpen && currentView !== 'stock-mutations' && appMode === 'IMPERSONATE' && (
          <StockMutationView
            isModalOpen={isStockModalOpen}
            setIsModalOpen={setIsStockModalOpen}
            preselectedItem={preselectedStockItem}
            preselectedType={preselectedStockType}
            modalOnly
          />
        )}
        {isCashModalOpen && currentView !== 'cashflow' && appMode === 'IMPERSONATE' && (
          <CashflowView
            isModalOpen={isCashModalOpen}
            setIsModalOpen={setIsCashModalOpen}
            defaultType={preselectedCashType}
            modalOnly
          />
        )}
      </Suspense>
    </div>
  );
};

export default function App() {
  return (
    <AuthGate>
      <AppProvider>
        <MainApp />
        <Analytics />
        <SpeedInsights />
      </AppProvider>
    </AuthGate>
  );
}
