# Order

Fake server at this point

# Running
Replace $certpath with path to public.pub

```
docker run -p 80:80 -v $certpath:/order/certificates --rm -it --name order ghcr.io/k10app/order
```

# building
```
docker build -t ghcr.io/k10app/order .
```

# postgres db ref
```powershell
docker run --name postgres `
  -e POSTGRES_DB=order -e POSTGRES_USER=orderlogin  -e POSTGRES_PASSWORD=orderpassword `
  -p 5432:5432 -v C:\k\k10app\postgres:/var/lib/postgresql/data `
  -it --rm postgres
```