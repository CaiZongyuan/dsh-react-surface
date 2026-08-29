# Security Policy

## Trust Model

`dsh-react-surface` runs installed DSH Client plugins as trusted same-origin code. ShadowRoot isolates styles and portals; it does not isolate JavaScript authority. Do not install an untrusted Surface and do not use this Runtime to load arbitrary remote HTML or scripts.

Application Adapters own authentication, resource authorization, input validation, data retention, and durable business effects. A DSH Session id, Surface id, browser `scopeKey`, or paired-device cookie is not application authorization.

## Host Routes

The optional Agent bridge accepts only:

- a loopback socket with a loopback Host and same-origin browser markers; or
- a request approved by a live `dsh-remote-web-ui` pairing service.

It never trusts `X-Forwarded-For`. Lease requests resolve an already-live native DSH Agent on the Host. Poll, result, and release requests require an unguessable per-lease capability token. Leases expire unless renewed by browser polling.

## Reporting A Vulnerability

Do not open a public issue containing exploit details, tokens, private URLs, logs, or application data. Use GitHub's private vulnerability reporting for this repository. Include the affected commit, DSH cohort, reproduction steps, impact, and any suggested mitigation.

Source-installed builds do not yet have a published security-support window. Fixes are applied to the current `main` branch and documented in repository history.
