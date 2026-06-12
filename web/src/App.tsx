import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { YoloPage } from './pages/YoloPage'
import { ReviewPage } from './pages/ReviewPage'
import { ChatShellPage } from './pages/ChatShellPage'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/chat" element={<ChatShellPage />} />
        <Route path="/chat/:conversationId" element={<ChatShellPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/yolo" element={<YoloPage />} />
          <Route path="/review" element={<ReviewPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
