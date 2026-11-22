import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface TokenPayload {
  id: string;
  email: string;
  name: string;
  role: 'agent' | 'lead';
}

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-dev-jwt-key-replace-in-production-1234567890';
const JWT_EXPIRES_IN = '7d';

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
