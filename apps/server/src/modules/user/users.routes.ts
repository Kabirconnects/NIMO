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

const router: Router = express.Router()

router.get("/", listUsers)
router.post("/", createUser)

router.post("/login", login)
router.post("/logout", logout)

// "/me" must be registered before "/:id", otherwise "me" is read as an id.
router.get("/me", getMe)

router.get("/:id", getUserById)
router.patch("/:id", updateUser)
router.delete("/:id", deleteUser)

export default router
