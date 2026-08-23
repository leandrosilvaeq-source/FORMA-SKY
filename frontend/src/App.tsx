import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Toaster } from '@/components/ui/sonner'
import { LoginPage } from '@/pages/LoginPage'
import { HomePage } from '@/pages/HomePage'
import { CustomersPage } from '@/pages/customers/CustomersPage'
import { ProductsPage } from '@/pages/products/ProductsPage'
import { ProductDetailPage } from '@/pages/products/ProductDetailPage'
import { CompaniesPage } from '@/pages/companies/CompaniesPage'
import { OrdersPage } from '@/pages/orders/OrdersPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

function App() {
  return (
    <AuthProvider>
      <Toaster />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clientes"
          element={
            <ProtectedRoute>
              <CustomersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/produtos"
          element={
            <ProtectedRoute>
              <ProductsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/produtos/:productId"
          element={
            <ProtectedRoute>
              <ProductDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresas"
          element={
            <ProtectedRoute>
              <CompaniesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pedidos"
          element={
            <ProtectedRoute>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        {/* Módulo 3 — Estoque (Incremento 4: somente consulta e navegação).
            /estoque sozinho não é uma área de verdade — redireciona para a
            primeira aba (Acessórios), sempre dentro de ProtectedRoute para
            que sessão ausente caia em /login antes de qualquer redirect
            interno. replace evita empilhar /estoque no histórico a cada
            visita. */}
        <Route
          path="/estoque"
          element={
            <ProtectedRoute>
              <Navigate to="/estoque/acessorios" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/estoque/acessorios"
          element={
            <ProtectedRoute>
              <InventoryPage area="acessorios" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/estoque/embalagens"
          element={
            <ProtectedRoute>
              <InventoryPage area="embalagens" />
            </ProtectedRoute>
          }
        />
        {/* Coringa: qualquer URL sem rota correspondente. Dentro da área
            protegida (exige sessão, como as demais) e nunca redireciona
            sozinha — o usuário decide clicar em "Voltar ao início". */}
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <NotFoundPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

export default App
