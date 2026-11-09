import { ChatPage } from "@/features/chat/components/chat-page"
import { Route, Routes } from "react-router-dom"

function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
    </Routes>
  )
}

export default App
