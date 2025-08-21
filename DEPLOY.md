## BrandSpot Puppy (Node Crawler) — Environment Notes

### Server
- **Server IP:** 91.99.182.20
- **Deploy User:** deploy
- **Architecture:** ARM64 (Hetzner CAX21)
- **Log Directory:** /var/log/brandspot
- **Node Version:** 20.17.0 (installed via nvm, per server playbook)

### Repository and Install Path
- **Git Repository:** https://github.com/sanderbz/brandspot-puppy
- **Target Location:** /opt/brandspot-puppy

### Services and Ports
- **Laravel Octane:** localhost:8000 (existing)
- **Go Research API:** localhost:8080 (existing)
- **Puppy Crawler:** localhost:3000 (bind to 127.0.0.1 only)

### Laravel Integration
- **CRAWL SERVICE URL:** http://localhost:3000/crawl (used by the Laravel app)
- No public exposure required; accessed internally by Laravel/Go services.

### Operational Conventions
- **Process owner:** deploy
- **Working directory:** /opt/brandspot-puppy
- **Systemd unit name:** brandspot-puppy.service (convention used alongside Octane/Queue)

### Endpoint
- POST /crawl
