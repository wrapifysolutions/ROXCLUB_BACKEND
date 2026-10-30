function resolveNavigation({ accountType = null, onboardingCompleted = false, coachStatus = null }) {
    const storedType = accountType || null;
    const isAdmin = storedType === 'admin';
    const inferredAthlete = !storedType && onboardingCompleted;
    const effectiveType = isAdmin ? 'admin' : storedType || (inferredAthlete ? 'athlete' : null);
    const coachAccess = coachStatus === 'approved';

    let next;
    if (isAdmin) {
        next = 'admin';
    } else if (onboardingCompleted) {
        next = 'home';
    } else if (!storedType && !coachStatus) {
        next = 'role_selection';
    } else if (storedType === 'athlete') {
        next = 'onboarding';
    } else if (storedType === 'coach' && !coachStatus) {
        next = 'coach_application';
    } else if (coachStatus === 'pending') {
        next = 'coach_pending';
    } else if (coachStatus === 'rejected') {
        next = 'coach_rejected';
    } else if (coachStatus === 'suspended') {
        next = 'coach_suspended';
    } else if (coachStatus === 'approved') {
        next = 'coach_home';
    } else {
        next = 'onboarding';
    }

    return {
        next,
        accountType: effectiveType,
        accountTypeStored: storedType,
        accountTypeSource: storedType ? 'stored' : inferredAthlete ? 'inferred_athlete' : 'unset',
        onboardingCompleted: Boolean(onboardingCompleted),
        permissions: {
            athlete: Boolean(onboardingCompleted || storedType === 'athlete'),
            coach: coachAccess,
            admin: isAdmin,
        },
        coach: coachStatus
            ? {
                  status: coachStatus,
                  canAccessClub: coachAccess,
              }
            : null,
    };
}

function rejectClientAdmin(body) {
    const requested = String(body?.accountType || body?.role || body?.account_type || '')
        .trim()
        .toLowerCase();
    if (requested === 'admin') {
        const error = new Error('Admin access cannot be requested');
        error.status = 403;
        error.code = 'ROLE_NOT_ALLOWED';
        throw error;
    }
}

module.exports = { resolveNavigation, rejectClientAdmin };
