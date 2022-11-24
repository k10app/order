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