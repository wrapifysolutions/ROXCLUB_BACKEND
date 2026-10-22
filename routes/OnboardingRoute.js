const express = require('express');
const Onboardingrouter = express.Router();
const UserOnboarding = require('../controllers/Onboarding/OnboardingControllers');
const authMiddleware = require('../middlewares/auth.middleware');
const CreateOnboardingQuestions = require('../controllers/Onboarding/OnboardingQuestionsControllers');
const CustomEmailSetup = require('../controllers/AuthControllers/CustomEmailSetup');
const VerifyEmailOTP = require('../controllers/AuthControllers/VerifyEmailOTP');
const CustomEmailLogin = require('../controllers/AuthControllers/CustomEmailLogin');
const { GetAuthSession, Logout } = require('../controllers/AuthControllers/AuthSession');
const ResendOtp = require('../controllers/AuthControllers/ResendOtp');
const {
    ForgotPassword,
    ResetPassword,
} = require('../controllers/AuthControllers/ForgotPassword');
const { GetHomeProfile } = require('../controllers/Home/HomeControllers');
const CompleteOnboarding = require('../controllers/Onboarding/CompleteOnboardingController');

Onboardingrouter.post('/onboarding', authMiddleware, UserOnboarding);
Onboardingrouter.post('/onboarding-questions', authMiddleware, CreateOnboardingQuestions);
Onboardingrouter.post('/api/onboarding/complete', authMiddleware, CompleteOnboarding);
Onboardingrouter.get('/api/home', authMiddleware, GetHomeProfile);
Onboardingrouter.post('/auth/email-signup', CustomEmailSetup);
Onboardingrouter.post('/auth/verify-email-otp', VerifyEmailOTP);
Onboardingrouter.post('/auth/email-login', CustomEmailLogin);
Onboardingrouter.get('/auth/me', GetAuthSession);
Onboardingrouter.post('/auth/logout', Logout);
Onboardingrouter.post('/auth/resend-otp', ResendOtp);
Onboardingrouter.post('/auth/forgot-password', ForgotPassword);
Onboardingrouter.post('/auth/reset-password', ResetPassword);

module.exports = Onboardingrouter;
