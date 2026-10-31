#include<stdio.h>
int main()
{ int o;
scanf("%d",&o);
int a;
int mi[o][o];
for(int i=0;i<o;i++)
    {for(int j=0;j<o;j++)
        {scanf("%d",&a);
    mi[i][j]=a;}}
int c,d;
scanf("%d %d",&c,&d);
int m=c-1;
int n=d-1;
int x;
scanf("%d",&x);
int bian[x];
int dr[4] = {0, -1, 1, 0};
    int dc[4] = {-1, 0, 0, 1};
    int nx[4] = {2, 0, 3, 1};

for(int k=0;k<x;k++)
{int p;
scanf("%d",&p);
int cu=p;
for(int t=0;t<4;t++)
{int mm=m+dr[cu];
int nn=n+dc[cu];
if(mi[mm][nn]==0)//if条件一定要==
{break;}
else{cu=nx[cu];}
}
m=m+dr[cu];
n=n+dc[cu];
bian[k]=cu;
}
printf("%d %d\n",m+1,n+1);
for(int q=0;q<x;q++)
printf("%d ",bian[q]);
return 0;




}



