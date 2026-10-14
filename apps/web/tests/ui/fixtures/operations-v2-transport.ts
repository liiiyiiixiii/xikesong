import { endpoints, matchEndpoint, errorDefinitions, type EndpointName } from '@zhishan/contracts/operations-v2';
import { fixture, errors, servingScenarios } from './operations-v2.ts';
import type { ContractFetch } from '../../../components/scales/operations-v2/client.ts';

export type PreviewScenario = keyof typeof servingScenarios | 'error' | 'conflict';
/** Explicit fixture transport only; it does not emulate persistence or business rules. */
export function createFixtureTransport(scenario: PreviewScenario): ContractFetch {
  return async (url, init) => {
    if (init.signal?.aborted) throw init.signal.reason;
    const parsed = new URL(url, 'http://fixture.local'), match = matchEndpoint(parsed.pathname, init.method ?? 'GET');
    if (!match) throw new Error('No fixture endpoint');
    const endpoint = endpoints[match.name];
    endpoint.params.parse(match.params);
    endpoint.query.parse(Object.fromEntries(parsed.searchParams));
    endpoint.body.parse(init.body === undefined ? undefined : JSON.parse(String(init.body)));
    if (scenario === 'error' || scenario === 'conflict') {
      const error = errors[scenario === 'error' ? 'unavailable' : 'conflict'];
      return Response.json(error, { status: errorDefinitions[error.error.code].status });
    }
    const result = match.name === 'serving' ? servingScenarios[scenario] : fixture(match.name as EndpointName).response;
    endpoint.response.parse(result);
    return endpoint.format === 'csv' ? new Response(String(result), { headers: { 'Content-Type': 'text/csv;charset=utf-8' } }) : Response.json(result);
  };
}
