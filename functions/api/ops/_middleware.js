// Gate for every /api/ops/* endpoint. Fails closed. POSTs also need a same-origin Origin.
import { guard } from '../../_lib/access.js';
export const onRequest = (context) => guard(context, { api: true });
