import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { PersonalDashboardView } from './components/PersonalDashboardView';
import { InventoryView } from './components/InventoryView';
import { StockMutationView } from './components/StockMutationView';
import { CashflowView } from './components/CashflowView';
import { SettingsView } from './components/SettingsView';
import { RfinARequestView } from './components/RfinARequestView';
import { RfinBInputView } from './components/RfinBInputView';
import { PlatformConsole } from './components/PlatformConsole';
import { CompanyConsole } from './components/CompanyConsole';
import { NotificationBanner } from './components/NotificationBanner';
import { AuthGate } from './components/AuthGate';
import { ItemBarang, JenisMutasiBarang, JenisMutasiKas } from './types';

const MainApp: React.FC = () => {
  const { currentView, appMode } = useApp();
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
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
          {/* Kotak Notifikasi / Undangan Resmi In-House */}
          <NotificationBanner />

          {/* Mode PSA */}
          {appMode === 'PSA' && <PlatformConsole />}

          {/* Mode CSA */}
          {appMode === 'CSA' && <CompanyConsole />}

          {/* Mode Personal */}
          {appMode === 'PERSONAL' && (
            <>
              {currentView === 'dashboard' && <PersonalDashboardView />}
              {currentView === 'rfin-a-request' && <RfinARequestView />}
              {currentView === 'rfin-b-input' && <RfinBInputView />}
              {currentView === 'settings' && <SettingsView />}
            </>
          )}

          {/* Mode Impersonate (Operasional 2 Modul Inti: Mutasi Barang & Mutasi Dana) */}
          {appMode === 'IMPERSONATE' && (
            <>
              {currentView === 'dashboard' && <DashboardView onOpenStockModal={handleOpenStockModal} onOpenCashModal={handleOpenCashModal} />}
              {currentView === 'rfin-b-input' && <RfinBInputView />}
              {currentView === 'inventory' && (
                <InventoryView onQuickMutate={(item, type) => handleOpenStockModal(type, item)} canMutate={true} />
              )}
              {currentView === 'stock-mutations' && (
                <StockMutationView
                  isModalOpen={isStockModalOpen}
                  setIsModalOpen={setIsStockModalOpen}
                  preselectedItem={preselectedStockItem}
                  preselectedType={preselectedStockType}
                />
              )}
              {currentView === 'cashflow' && (
                <CashflowView
                  isModalOpen={isCashModalOpen}
                  setIsModalOpen={setIsCashModalOpen}
                  defaultType={preselectedCashType}
                />
              )}
              {/* Di Mode Impersonate tidak ada Settings; jika diarahkan ke settings, tampilkan dashboard */}
              {currentView === 'settings' && <DashboardView onOpenStockModal={handleOpenStockModal} onOpenCashModal={handleOpenCashModal} />}
            </>
          )}
        </main>
      </div>

      {/* Modal Dialog Pop-up Transaksi (Saat Dipanggil Cepat dari Dasbor) */}
      {currentView !== 'stock-mutations' && appMode === 'IMPERSONATE' && (
        <StockMutationView
          isModalOpen={isStockModalOpen}
          setIsModalOpen={setIsStockModalOpen}
          preselectedItem={preselectedStockItem}
          preselectedType={preselectedStockType}
          modalOnly
        />
      )}
      {currentView !== 'cashflow' && appMode === 'IMPERSONATE' && (
        <CashflowView
          isModalOpen={isCashModalOpen}
          setIsModalOpen={setIsCashModalOpen}
          defaultType={preselectedCashType}
          modalOnly
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthGate>
      <AppProvider>
        <MainApp />
      </AppProvider>
    </AuthGate>
  );
}
