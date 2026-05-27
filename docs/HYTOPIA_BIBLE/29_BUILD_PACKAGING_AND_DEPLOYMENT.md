# Build, Packaging & Deployment to the Hytopia Platform

## Development vs Production

### Local Development
- Use `npm run dev` or `hytopia start`
- Fast iteration
- Self-signed certs
- Local client or hytopia.com/play

### Production / Platform Deployment
- Use `hytopia package` or `hytopia build`
- This creates a production-ready bundle
- Upload through the Hytopia developer portal / world editor

## Key Commands

- `hytopia build` — Prepare for packaging
- `hytopia package` — Creates the final uploadable game package
- `hytopia upgrade-project` — Updates your project to newer SDK versions

## Important Packaging Considerations

- All asset paths must be correct relative to the final bundle
- Large assets (especially audio and high-poly models) affect load times and hosting costs
- Make sure your `package.json` has the correct `hytopia` version pinned

## Platform Gotchas

- The platform hosts and scales your game for you once uploaded
- There are limits on asset size, concurrent players, etc. (check current limits in the developer portal)
- Debugging production issues is much harder than local — log everything important

## Recommended Pre-Upload Checklist

1. Test with `npm run build` + local client
2. Verify all critical assets are included
3. Remove debug logs and development-only code paths
4. Confirm performance is acceptable at expected player counts
5. Document the exact SDK version used

## Versioning Strategy

It is highly recommended to tag releases in Git with the SDK version they were built against (e.g. `v0.3.0-sdk-0.15.2`).

This becomes extremely valuable when the SDK introduces breaking changes.
