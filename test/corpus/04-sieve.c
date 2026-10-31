#include <stdio.h>
#define MAXN 10000
char is_prime[MAXN + 1];
int cnt[MAXN + 1];
void sieve_eratosthenes(int n)
{
int i, j;
for (i = 0; i <= n; ++i)
is_prime[i] = 1;
is_prime[0] = 0;
is_prime[1] = 0;
for (i = 2; i <= n / i; ++i)
if (is_prime[i])
for (j = i * i; j <= n; j += i)
is_prime[j] = 0;
}
int main()
{
int i, T, L, R;
sieve_eratosthenes(MAXN);
for (i = 1; i <= MAXN; ++i)
cnt[i] = cnt[i - 1] + is_prime[i];
scanf("%d", &T);
while (T--) {
scanf("%d %d", &L, &R);
printf("%d\n", cnt[R] - cnt[L - 1]);
}
return 0;