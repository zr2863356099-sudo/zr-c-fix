#include <stdio.h>

int main() {
    double s, x;                 
    double sumP = 0.0, sumS = 0.0;  
    while (scanf("%lf %lf", &s, &x) == 2) {
        double p;
        if (x < 60) {
            p = 0.0;             
        } else {
            double d = 100.0 - x;
            p = 4.0 - 3.0 * d * d / 1600.0;  
        }
        sumP += p * s;
        sumS += s;
    }
    printf("%.2f\n", sumP / sumS);   
    return 0;
}
