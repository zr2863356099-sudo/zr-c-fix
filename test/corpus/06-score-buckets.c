#include<stdio.h>
int main()
{
int n ;
scanf("%d",&n);
long long Excellent[100005];
long long Good[100005];
long long Pass[100005];
long long Fail[100005];
long long xue;
int fen;
int e=0,g=0,p=0,f=0;
while(n--){
scanf("%lld %d",&xue,&fen);
if(fen>=90&&fen <=100)
{Excellent[e]=xue; 
e++;}
else if(fen>=80&&fen<=89)
{Good[g]=xue;
g++;}
else if(fen>=60&&fen<=79)
{Pass[p]=xue;
p++;}
else if(fen>=0&&fen<=59)
{Fail[f]=xue; 
f++;}}
printf("Excellent\n");
for(int i=0;i<e;i++)
{printf("%lld\n",Excellent[i]);}
printf("Good\n");
for(int i=0;i<g;i++)
{printf("%lld\n",Good[i]);}
printf("Pass\n");
for(int i=0;i<p;i++)
{printf("%lld\n",Pass[i]);}
printf("Fail\n");
for(int i=0;i<f;i++)
{printf("%lld\n",Fail [i]);}
return 0;}