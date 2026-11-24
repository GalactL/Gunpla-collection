import { HttpError, sendJson } from '../routes/index.js';
import { createCopy, deleteCopy, listCopies, updateCopy } from './service.js';

const idOf = (p) => {
  const id = Number(p.id);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Exemplaire introuvable');
  return id;
};

export default function routes(router, { db }) {
  router.add('GET', '/api/copies', () => listCopies(db));
  router.add('POST', '/api/copies', (req, res, { body }) => sendJson(res, 201, createCopy(db, body)));
  router.add('PATCH', '/api/copies/:id', (req, res, { params, body }) => updateCopy(db, idOf(params), body));
  router.add('DELETE', '/api/copies/:id', (req, res, { params }) => deleteCopy(db, idOf(params)));
}
