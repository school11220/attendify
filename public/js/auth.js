/* Custom UI using Clerk JS v5 APIs. Credentials are sent directly to Clerk. */
(async () => {
  const el = id => document.getElementById(id);
  const signup = location.pathname === '/sign-up';
  let clerk, phase = signup ? 'signup' : 'signin', busy = false, resendAt = 0;
  const show = (id, visible) => { el(id).hidden = !visible; };
  function error(err) {
    el('error').textContent = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || 'Unable to continue. Please try again.';
  }
  async function run(action) {
    if (busy) return;
    busy = true; el('error').textContent = ''; el('status').textContent = '';
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await action(); } catch (err) { error(err); }
    finally { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  function verification(nextPhase) {
    phase = nextPhase;
    ['names', 'username-field', 'identifier-field', 'password-field', 'google', 'forgot'].forEach(id => show(id, false));
    el('identifier').required = false; el('password').required = false;
    show('code-field', true); el('code').required = true; show('resend', true);
    el('submit').textContent = 'Verify and continue'; el('code').focus();
    el('status').textContent = 'Enter the verification code sent to your email.';
    resendAt = Date.now() + 30000;
  }
  async function finish(result) {
    if (result.status === 'complete' && result.createdSessionId) {
      await clerk.setActive({ session: result.createdSessionId }); location.assign('/'); return true;
    }
    return false;
  }
  function advanced() {
    // Preserve configured MFA, new-device challenges, and missing OAuth fields.
    show('auth-controls', false);
    el('status').textContent = 'Complete the additional account verification below.';
    const options = { routing: 'hash', signInUrl: '/sign-in', signUpUrl: '/sign-up', fallbackRedirectUrl: '/', appearance: { variables: { colorPrimary: '#ed3737' } } };
    if (signup) clerk.mountSignUp(el('advanced'), options);
    else clerk.mountSignIn(el('advanced'), options);
  }
  try {
    clerk = await window.attendifyAuthReady;
    if (location.pathname === '/sso-callback' || location.hash.includes('/sso-callback')) {
      el('status').textContent = 'Completing your Google sign-in…';
      await clerk.handleRedirectCallback({ signInUrl: '/sign-in', signUpUrl: '/sign-up', signInFallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/', continueSignUpUrl: '/sign-up#continue', firstFactorUrl: '/sign-in#continue', secondFactorUrl: '/sign-in#continue', resetPasswordUrl: '/sign-in#continue' });
      return;
    }
    if (clerk.user) { location.assign('/'); return; }
    if (location.hash) { advanced(); return; }
    el('title').textContent = signup ? 'Create your account' : 'Welcome back';
    el('intro').textContent = signup ? 'A little planning starts here.' : 'Sign in to your attendance dashboard.';
    show('auth-controls', true); el('status').textContent = '';
    show('names', signup); show('username-field', signup); show('forgot', !signup);
    el('first').required = signup; el('last').required = signup; el('username').required = signup;
    if (signup) {
      el('identifier-label').textContent = 'Email address'; el('identifier').type = 'email'; el('identifier').autocomplete = 'email';
      el('password').autocomplete = 'new-password'; el('submit').textContent = 'Create account';
    }
    el('switch').innerHTML = signup ? 'Already have an account? <a href="/sign-in">Sign in</a>' : 'New to Attendify? <a href="/sign-up">Create an account</a>';
    el('google').addEventListener('click', () => run(async () => {
      const attempt = signup ? clerk.client.signUp : clerk.client.signIn;
      await attempt.authenticateWithRedirect({ strategy: 'oauth_google', redirectUrl: location.origin + '/sso-callback', redirectUrlComplete: location.origin + '/' });
    }));
    el('account-form').addEventListener('submit', event => {
      event.preventDefault();
      run(async () => {
        let result;
        if (phase === 'signin') {
          result = await clerk.client.signIn.create({ identifier: el('identifier').value.trim(), password: el('password').value });
          if (!(await finish(result))) advanced();
        } else if (phase === 'signup') {
          result = await clerk.client.signUp.create({ emailAddress: el('identifier').value.trim(), password: el('password').value, firstName: el('first').value.trim(), lastName: el('last').value.trim(), username: el('username').value.trim() });
          if (!(await finish(result))) {
            if (result.unverifiedFields.includes('email_address')) {
              await clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' }); verification('verify-signup');
            } else advanced();
          }
        } else if (phase === 'verify-signup') {
          result = await clerk.client.signUp.attemptEmailAddressVerification({ code: el('code').value.trim() });
          if (!(await finish(result))) advanced();
        } else if (phase === 'reset-code') {
          await clerk.client.signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code: el('code').value.trim() });
          phase = 'reset-password'; show('code-field', false); show('resend', false); show('password-field', true);
          el('code').required = false; el('password').required = true; el('password').value = ''; el('password').autocomplete = 'new-password'; el('submit').textContent = 'Save new password';
        } else if (phase === 'reset-password') {
          result = await clerk.client.signIn.resetPassword({ password: el('password').value });
          if (!(await finish(result))) advanced();
        }
      });
    });
    el('forgot').addEventListener('click', () => run(async () => {
      const identifier = el('identifier').value.trim();
      if (!identifier) { el('identifier').focus(); throw new Error('Enter your account email address first.'); }
      await clerk.client.signIn.create({ strategy: 'reset_password_email_code', identifier }); verification('reset-code');
    }));
    el('resend').addEventListener('click', () => run(async () => {
      if (Date.now() < resendAt) throw new Error('Please wait 30 seconds between verification emails.');
      if (phase === 'verify-signup') await clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      else {
        const factor = clerk.client.signIn.supportedFirstFactors.find(item => item.strategy === 'reset_password_email_code');
        await clerk.client.signIn.prepareFirstFactor({ strategy: 'reset_password_email_code', emailAddressId: factor.emailAddressId });
      }
      resendAt = Date.now() + 30000; el('status').textContent = 'A new code has been sent.';
    }));
  } catch (err) { el('status').textContent = ''; error(err); }
})();
