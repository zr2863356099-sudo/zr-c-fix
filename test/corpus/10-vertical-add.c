#include<stdio.h>
int main()
{
    long long a, b;
    scanf("%lld %lld", &a, &b);
       long long sum=a+b;
    char str[32];
    sprintf(str, "%lld", sum);
    int len = strlen(str);
    int w = len + 2;
    printf("%*lld\n", w, a);
    printf("+%*lld\n", w-1, b);
    for (int i = 0; i < w; i++)
    {
        printf("-");
    }
    printf("\n");
    printf("%*lld\n", w, sum);
    return 0;
}