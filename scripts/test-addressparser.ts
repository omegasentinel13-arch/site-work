import nodemailer from 'nodemailer';
// @ts-ignore
import addressparser from 'nodemailer/lib/addressparser';

const parsed = addressparser('AB CONSTRUCTIONS & INTERIORS omegasentinel13@gmail.com');
console.log('Parsed address:', JSON.stringify(parsed, null, 2));
