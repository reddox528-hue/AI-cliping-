import readline from 'node:readline';
import { env } from '../server/config/env.ts';
import { initializeSuperAdmin } from '../server/services/superAdminSetup.ts';

function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (val) => {
        rl.close();
        resolve(val);
      });
      return;
    }

    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
        return;
      }
      if (ch === '\u0003') {
        stdin.setRawMode(false);
        process.exit(130);
      }
      if (ch === '\u007f' || ch === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      password += ch;
      process.stdout.write('*');
    };

    stdin.on('data', onData);
  });
}

async function main() {
  console.log('\n=== REDDOX Clipora AI — Initial Super Admin Setup (Google AI Studio) ===');
  console.log(`Firebase Project: ${env.firebaseProjectId}`);
  console.log(`Configured Owner Email: ${env.superAdminEmail}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const displayNameInput = await askQuestion(rl, 'Super Admin Display Name [REDDOX Super Admin]: ');
    const emailInput = await askQuestion(rl, `Super Admin Email [${env.superAdminEmail}]: `);
    rl.close();

    const password = await askHidden('Super Admin Password (min 12 chars, upper+lower+number): ');
    const confirmPassword = await askHidden('Confirm Password: ');

    if (password !== confirmPassword) {
      console.error('\nError: Passwords do not match.');
      process.exit(1);
    }

    let setupSecret = '';
    if (env.superAdminBootstrapSecret) {
      setupSecret = await askHidden('Enter SUPER_ADMIN_BOOTSTRAP_SECRET: ');
    }

    const email = (emailInput.trim() || env.superAdminEmail).toLowerCase();
    const displayName = displayNameInput.trim() || 'REDDOX Super Admin';

    const result = await initializeSuperAdmin({
      email,
      password,
      displayName,
      setupSecret: setupSecret || undefined,
    });

    console.log('\n[OK] Super Admin Firebase Auth account established!');
    console.log(`UID:   ${result.uid}`);
    console.log(`Email: ${result.email}`);
    console.log(`Role:  ${result.role}`);

    if (!result.emailVerified) {
      console.log('\nIMPORTANT NEXT STEP:');
      console.log(
        result.verificationEmailSent
          ? `A verification email has been sent to ${result.email}. Click the verification link in your inbox before signing in.`
          : `Verify your email address for ${result.email} before signing in.`
      );
      console.log('Then visit your live app, click "Admin Access" at the bottom-right footer, and sign in.');
    } else {
      console.log('\nYou can now sign in from any device via the "Admin Access" footer link (/secure-control-panel).');
    }
  } catch (err) {
    rl.close();
    console.error('\nSetup aborted:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
