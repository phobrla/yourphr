import {isAbsolute} from 'node:path';
import {ApiError} from '../framework/ApiContext.js';

export function terminologyPath(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'terminology file location must be a string');
  const path = value.trim();
  if (path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path) || (path !== '' && !isAbsolute(path))) {
    throw new ApiError(400, 'terminology file location must be an absolute server-side path, or empty to remove the mapping');
  }
  return path;
}
