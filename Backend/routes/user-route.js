import express from "express";
import { getSingleUser, getUserDetails, getUsersList, loginUser, logout, registerUser, requestPasswordReset, resetPassword, UpdatePassword, updateProfile } from "../controller/user-controller.js";
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';

const router = express.Router();

router.route("/register").post(registerUser);

router.route("/login").post(loginUser);

router.route("/logout").post(logout);

router.route("/password/forgot").post(requestPasswordReset);

router.route("/reset/:token").post(resetPassword);

router.route("/profile").post(verifyUserAuth, getUserDetails);

router.route("/password/update").post(verifyUserAuth, UpdatePassword);

router.route("/profile/update").post(verifyUserAuth, updateProfile);

router.route("/admin/users").get(verifyUserAuth, roleBaseAccess('admin'), getUsersList);

router.route("/admin/user/:id").get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser);

export default router;