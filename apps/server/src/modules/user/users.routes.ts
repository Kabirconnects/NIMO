import express, { type Router } from "express"
import {
  createUser,
  deleteUser,
  getMe,
  getUserById,
  listUsers,
  login,
  logout,
  updateUser,
} from "./users.controller.js"
import { authMiddleware } from "../../middleware/auth.middleware.js"

const router: Router = express.Router()

router.get("/", authMiddleware, listUsers)
router.post("/", createUser)

router.post("/login", login)
router.post("/logout", logout)

// "/me" must be registered before "/:id", otherwise "me" is read as an id.
router.get("/me", authMiddleware, getMe)

router.get("/:id", authMiddleware, getUserById)
router.patch("/:id", authMiddleware, updateUser)
router.delete("/:id", authMiddleware, deleteUser)

export default router
