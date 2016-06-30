import * as express from 'express';
import * as graphql from 'graphql';
import { runQuery } from '../core/runQuery';

import * as GraphiQL from '../modules/renderGraphiQL';

// TODO: will these be the same or different for other integrations?
/*
 * ExpressApolloOptions
 *
 * - schema: an executable GraphQL schema used to fulfill requests.
 * - (optional) formatError: Formatting function applied to all errors before response is sent
 * - (optional) rootValue: rootValue passed to GraphQL execution
 * - (optional) context: the context passed to GraphQL execution
 * - (optional) logFunction: a function called for logging events such as execution times
 * - (optional) formatParams: a function applied to the parameters of every invocation of runQuery
 * - (optional) validationRules: extra validation rules applied to requests
 * - (optional) formatResponse: a function applied to each graphQL execution result
 *
 */
export interface ExpressApolloOptions {
  schema: graphql.GraphQLSchema;
  formatError?: Function;
  rootValue?: any;
  context?: any;
  logFunction?: Function;
  formatParams?: Function;
  validationRules?: Array<graphql.ValidationRule>;
  formatResponse?: Function;
}

export interface ExpressApolloOptionsFunction {
  (req?: express.Request): ExpressApolloOptions | Promise<ExpressApolloOptions>;
}

// Design principles:
// - there is just one way allowed: POST request with JSON body. Nothing else.
// - simple, fast and secure
//

export interface ExpressHandler {
  (req: express.Request, res: express.Response, next): void;
}

export function graphqlHTTP(options: ExpressApolloOptions | ExpressApolloOptionsFunction): ExpressHandler {
  if (!options) {
    throw new Error('Apollo Server requires options.');
  }

  if (arguments.length > 1) {
    // TODO: test this
    throw new Error(`Apollo Server expects exactly one argument, got ${arguments.length + 1}`);
  }

  return async (req: express.Request, res: express.Response, next) => {
    let optionsObject: ExpressApolloOptions;
    if (isOptionsFunction(options)) {
      optionsObject = await options(req);
    } else {
      optionsObject = options;
    }

    const formatErrorFn = optionsObject.formatError || graphql.formatError;

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405);
      res.send('Apollo Server supports only POST requests.');
      return;
    }

    if (!req.body) {
      res.status(500);
      res.send('POST body missing. Did you forget "app.use(bodyParser.json())"?');
      return;
    }

    let b = req.body;
    let isBatch = true;
    // TODO: do something different here if the body is an array.
    // Throw an error if body isn't either array or object.
    if (!Array.isArray(b)) {
      isBatch = false;
      b = [b];
    }

    let responses: Array<graphql.GraphQLResult> = [];
    for (let requestParams of b) {
      try {
        const query = requestParams.query;
        const operationName = requestParams.operationName;
        let variables = requestParams.variables;

        if (typeof variables === 'string') {
          // TODO: catch errors
          variables = JSON.parse(variables);
        }

        let params = {
          schema: optionsObject.schema,
          query: query,
          variables: variables,
          rootValue: optionsObject.rootValue,
          operationName: operationName,
          logFunction: optionsObject.logFunction,
          validationRules: optionsObject.validationRules,
          formatError: formatErrorFn,
          formatResponse: optionsObject.formatResponse,
        };

        if (optionsObject.formatParams) {
          params = optionsObject.formatParams(params);
        }

        if (!params.query) {
          throw new Error('Must provide query string.');
        }

        responses.push(await runQuery(params));
      } catch (e) {
        responses.push({ errors: [formatErrorFn(e)] });
      }
    }

    res.set('Content-Type', 'application/json');
    if (isBatch) {
      res.send(JSON.stringify(responses));
    } else {
      const gqlResponse = responses[0];
      if (gqlResponse.errors && typeof gqlResponse.data === 'undefined') {
        res.status(400);
      }
      res.send(JSON.stringify(gqlResponse));
    }

  };
}

function isOptionsFunction(arg: ExpressApolloOptions | ExpressApolloOptionsFunction): arg is ExpressApolloOptionsFunction {
  return typeof arg === 'function';
}

/* This middleware returns the html for the GraphiQL interactive query UI
 *
 * GraphiQLData arguments
 *
 * - endpointURL: the relative or absolute URL for the endpoint which GraphiQL will make queries to
 * - (optional) query: the GraphQL query to pre-fill in the GraphiQL UI
 * - (optional) variables: a JS object of variables to pre-fill in the GraphiQL UI
 * - (optional) operationName: the operationName to pre-fill in the GraphiQL UI
 * - (optional) result: the result of the query to pre-fill in the GraphiQL UI
 */

export function renderGraphiQL(options: GraphiQL.GraphiQLData) {
  return (req: express.Request, res: express.Response, next) => {

    const q = req.query || {};
    const query = q.query || '';
    const variables = q.variables || '{}';
    const operationName = q.operationName || '';


    const graphiQLString = GraphiQL.renderGraphiQL({
      endpointURL: options.endpointURL,
      query: query || options.query,
      variables: JSON.parse(variables) || options.variables,
      operationName: operationName || options.operationName,
    });
    res.set('Content-Type', 'text/html');
    res.send(graphiQLString);
  };
}