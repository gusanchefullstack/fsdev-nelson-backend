import { v7 as uuidv7 } from 'uuid';

// Time-ordered UUIDs keep primary-key indexes compact
export const newId = (): string => uuidv7();
