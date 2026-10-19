const express = require('express');
const Onboardingrouter = express.Router();
const UserOnboarding = require('../controllers/OnboardingControllers');
const authMiddleware = require('../middlewares/auth.middleware');
const CreateOnboardingQuestions = require('../controllers/OnboardingQuestionsControllers');
const CustomEmailSetup = require('../controllers/CustomEmailSetup');
const VerifyEmailOTP = require('../controllers/VerifyEmailOTP');
const CustomEmailLogin = require('../controllers/CustomEmailLogin');
const { GetAuthSession, Logout } = require('../controllers/AuthSession');
const ResendOtp = require('../controllers/ResendOtp');




Onboardingrouter.post('/onboarding', authMiddleware, UserOnboarding);
Onboardingrouter.post('/onboarding-questions', authMiddleware, CreateOnboardingQuestions);
Onboardingrouter.post('/auth/email-signup', CustomEmailSetup);
Onboardingrouter.post('/auth/verify-email-otp', VerifyEmailOTP);
Onboardingrouter.post('/auth/email-login', CustomEmailLogin);
Onboardingrouter.get('/auth/me', GetAuthSession);
Onboardingrouter.post('/auth/logout', Logout);
Onboardingrouter.post('/auth/resend-otp', ResendOtp);

module.exports = Onboardingrouter;
